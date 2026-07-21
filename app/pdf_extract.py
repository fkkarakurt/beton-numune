# -*- coding: utf-8 -*-
"""
Beton deney raporu PDF'inden (metin katmanlı) tamamen yerel ve ücretsiz veri
çıkarma. Hiçbir dış servis / API kullanılmaz; pdfplumber ile deterministik
olarak okunur.

Yaklaşım:
- Başlık alanları (rapor no, YİBF, beton sınıfı, tarihler, firmalar...) tüm
  sayfa metni üzerinde etiket tabanlı olarak aranır. Türkçe karakterler
  eşleştirme için ASCII'ye normalize edilir, değerler orijinal metinden alınır.
- Numune sonuçları pdfplumber tablo çıkarımıyla okunur: "28 Günlük Numune"
  sütunu başlıktan bulunur, her satırda "grup-numune" (örn. 1-2) kalıp
  numarasından grup belirlenir. Tablo bulunamazsa satır bazlı yedek çözümleyici
  devreye girer.
- Taranmış (metin katmanı olmayan) PDF'ler ve fotoğraflar okunamaz; kullanıcı
  verileri elle girer.
"""
from __future__ import annotations

import io
import re
from typing import Optional

import pdfplumber

from .models import ExtractedGroup, ExtractedReport


class ExtractionError(RuntimeError):
    pass


# --------------------------------------------------------------------------
# Türkçe -> ASCII normalizasyonu (uzunluk korunur; span'ler orijinali keser)
# --------------------------------------------------------------------------
_TR_MAP = str.maketrans({
    "İ": "I", "ı": "i", "Ş": "S", "ş": "s", "Ğ": "G", "ğ": "g",
    "Ü": "U", "ü": "u", "Ö": "O", "ö": "o", "Ç": "C", "ç": "c",
})


def _norm(s: str) -> str:
    return s.translate(_TR_MAP).upper()


# Başlık alanı etiketleri (normalize edilmiş biçimde aranır)
_LABELS = [
    "DENEY ISTEYEN FIRMA", "YAPI SAHIBI", "MUTEAHHIT FIRMA",
    "YIBF NUMARASI", "YIBF NO", "SANTIYE ADRESI",
    "NUMUNENIN ALINIS TARIHI", "PAFTA / ADA / PARSEL", "PAFTA/ADA/PARSEL",
    "NUMUNENIN LAB. GELIS TARIHI", "NUMUNENIN LAB.GELIS TARIHI",
    "KAT/KOT/BLOK", "KAT / KOT / BLOK",
    "DENEY TARIHI 7 GUN", "DENEY TARIHI 28 GUN", "NUMUNEYI ALAN",
    "URETICI FIRMA", "NUMUNENIN BOYUTU - SEKLI", "NUMUNENIN BOYUTU",
    "BETON SINIFI-MIKTARI", "BETON SINIFI - MIKTARI", "BETON SINIFI",
    "ALINAN NUMUNE ADEDI", "YAPI ELEMANI", "ISTENEN DENEYLER",
    "UYG. STANDARDLAR", "UYG.STANDARDLAR",
    "RAPOR TARIHI", "RAPOR NO", "LAB.NO", "LAB NO", "BAK. R. NO",
]
_LABEL_RE = re.compile("|".join(re.escape(l) for l in
                                sorted(_LABELS, key=len, reverse=True)))

_DATE_RE = re.compile(r"(\d{1,2})[./](\d{1,2})[./](\d{4})")
_KALIP_RE = re.compile(r"^\s*(\d+)\s*-\s*(\d+)\s*$")
_SLUMP_CLASS_RE = re.compile(r"^\s*(S[1-5])\s*$")


def _find_field(text: str, norm: str, *labels: str) -> Optional[str]:
    """Etiketten sonra, bir sonraki etikete ya da satır sonuna kadarki değer."""
    for label in labels:
        m = re.search(re.escape(label) + r"\s*:?", norm)
        if not m:
            continue
        start = m.end()
        nl = norm.find("\n", start)
        if nl == -1:
            nl = len(norm)
        nxt = _LABEL_RE.search(norm, start)
        end = min(nl, nxt.start()) if (nxt and nxt.start() < nl) else nl
        value = text[start:end].strip(" :\t")
        if value:
            return value
    return None


def _to_iso(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    m = _DATE_RE.search(value)
    if not m:
        return None
    d, mo, y = m.groups()
    return f"{y}-{int(mo):02d}-{int(d):02d}"


def _to_float(cell: Optional[str]) -> Optional[float]:
    if cell is None:
        return None
    s = str(cell).strip().replace("\n", "")
    if not s:
        return None
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def _strength(cell: Optional[str]) -> Optional[float]:
    v = _to_float(cell)
    if v is None or not (2.0 <= v <= 150.0):
        return None
    return v


# --------------------------------------------------------------------------
# Tablo tabanlı numune okuma
# --------------------------------------------------------------------------
def _header_columns(table: list[list]) -> tuple[Optional[int], Optional[int],
                                                Optional[int], bool, int]:
    """(28g sütunu, beyan slump sütunu, ölçülen slump sütunu,
        ölçülen cm mi, başlık satırı sonu)"""
    col28 = col_beyan = col_olc = None
    olc_cm = True
    header_end = 0
    for ri, row in enumerate(table):
        for ci, cell in enumerate(row):
            if not cell:
                continue
            n = _norm(str(cell))
            if "28" in n and "GUNLUK" in n.replace(" ", ""):
                if "SONUC" not in n and col28 is None:
                    col28 = ci
                header_end = max(header_end, ri + 1)
            if "SLUMP" in n or "COKME" in n:
                if "BEYAN" in n and col_beyan is None:
                    col_beyan = ci
                if ("OLCULEN" in n or "OLC" in n) and col_olc is None:
                    col_olc = ci
                    olc_cm = "MM" not in n.replace("/", "").replace("(", "")
                header_end = max(header_end, ri + 1)
        if col28 is not None and ri >= header_end + 1:
            break
    return col28, col_beyan, col_olc, olc_cm, header_end


def _parse_tables(pdf, notes: list[str]):
    """[(grup_no, kalıp, dayanım, beyan_slump, ölçülen_mm), ...]

    Bir tablo yalnızca en az bir geçerli dayanım değeri üretirse numune
    tablosu sayılır; kriter/çökme referans tabloları (içlerindeki "2 - 4",
    "50 - 90" gibi hücreler kalıp desenine benzese de) hiçbir dayanım değeri
    üretemediği için kendiliğinden elenir.
    """
    rows_out = []
    used_fallback = False
    for page in pdf.pages:
        for table in page.extract_tables():
            col28, col_beyan, col_olc, olc_cm, hdr_end = _header_columns(table)
            table_rows = []          # bu tablodan çıkan geçerli satırlar
            missing: list[str] = []  # kalıbı bulunup değeri okunamayanlar
            for row in table[hdr_end:]:
                cells = ["" if c is None else str(c).strip() for c in row]
                kalip = group = None
                for c in cells:
                    m = _KALIP_RE.match(c.replace("\n", ""))
                    if m:
                        kalip, group = m.group(0).replace(" ", ""), m.group(1)
                        break
                if kalip is None:
                    continue
                # dayanım: öncelik "28 Günlük" sütunu; yoksa satırdaki tek
                # ondalık basamaklı ilk uygun sayı (kırılma yükü 2, yoğunluk 3
                # ondalıklı olduğundan karışmaz)
                value = None
                row_fallback = False
                if col28 is not None and col28 < len(cells):
                    value = _strength(cells[col28])
                if value is None:
                    cands = [_strength(c) for c in cells
                             if re.fullmatch(r"\d{1,3}[.,]\d",
                                             c.replace("\n", ""))]
                    cands = [v for v in cands if v is not None]
                    if cands:
                        value = cands[0]
                        row_fallback = col28 is None
                if value is None:
                    missing.append(kalip)
                    continue
                beyan = None
                if col_beyan is not None and col_beyan < len(cells):
                    m = _SLUMP_CLASS_RE.match(cells[col_beyan])
                    if m:
                        beyan = m.group(1)
                if beyan is None:
                    for c in cells:
                        m = _SLUMP_CLASS_RE.match(c)
                        if m:
                            beyan = m.group(1)
                            break
                olc_mm = None
                if col_olc is not None and col_olc < len(cells):
                    v = _to_float(cells[col_olc])
                    if v is not None and v > 0:
                        olc_mm = v * 10 if (olc_cm and v <= 35) else v
                table_rows.append((group, kalip, value, beyan, olc_mm))
                used_fallback = used_fallback or row_fallback
            if not table_rows:
                continue  # numune tablosu değil — notsuz atla
            rows_out.extend(table_rows)
            for k in missing:
                notes.append(f"Kalıp {k}: 28 günlük dayanım değeri okunamadı "
                             "— elle kontrol edin.")
    if used_fallback:
        notes.append("Bazı sayfalarda sütun başlığı bulunamadığından dayanım "
                     "değerleri satır düzeninden belirlendi — değerleri "
                     "belgeyle karşılaştırın.")
    return rows_out


def _parse_text_rows(pdf, notes: list[str]):
    """Tablo çıkarımı başarısızsa: metin satırlarından yedek okuma."""
    rows_out = []
    line_re = re.compile(r"(?<!\d)(\d{1,3})\s*-\s*(\d{1,2})(?!\d)")
    for page in pdf.pages:
        for line in (page.extract_text() or "").splitlines():
            m = line_re.search(line)
            if not m:
                continue
            # Gerçek kalıp numarasında numune sırası küçüktür (örn. 7-2);
            # "10 - 40" gibi çökme aralıkları elenir.
            if int(m.group(2)) > 12:
                continue
            tail = line[m.end():]
            cands = re.findall(r"(?<![\d.,])(\d{1,3},\d)(?![\d])", tail)
            vals = [v for v in (_strength(c) for c in cands)
                    if v is not None and v >= 5.0]
            if not vals:
                continue
            group, kalip = m.group(1), f"{m.group(1)}-{m.group(2)}"
            slump = None
            sm = re.search(r"\b(S[1-5])\b", tail)
            if sm:
                slump = sm.group(1)
            rows_out.append((group, kalip, vals[0], slump, None))
    if rows_out:
        notes.append("Numune tablosu satır bazlı yedek yöntemle okundu — "
                     "değerleri belgeyle mutlaka karşılaştırın.")
    return rows_out


# --------------------------------------------------------------------------
# Ana giriş
# --------------------------------------------------------------------------
def _parse_pdf(data: bytes, notes: list[str]) -> ExtractedReport:
    try:
        pdf = pdfplumber.open(io.BytesIO(data))
    except Exception as exc:
        raise ExtractionError(f"PDF açılamadı: {exc}") from exc

    with pdf:
        pages_text = [(p.extract_text() or "") for p in pdf.pages]
        text = "\n".join(pages_text)
        if len(text.strip()) < 40:
            raise ExtractionError(
                "PDF'te okunabilir metin katmanı yok (muhtemelen tarama/"
                "fotoğraf). Bu ücretsiz sürüm yalnızca dijital PDF raporları "
                "okuyabilir — verileri elle girin.")
        norm = _norm(text)

        rep = ExtractedReport()
        rep.rapor_no = _find_field(text, norm, "RAPOR NO")
        rep.yibf_no = _find_field(text, norm, "YIBF NUMARASI", "YIBF NO")
        rep.deney_isteyen = _find_field(text, norm, "DENEY ISTEYEN FIRMA")
        rep.muteahhit = _find_field(text, norm, "MUTEAHHIT FIRMA")
        rep.yapi_sahibi = _find_field(text, norm, "YAPI SAHIBI")
        rep.uretici_firma = _find_field(text, norm, "URETICI FIRMA")
        rep.santiye_adresi = _find_field(text, norm, "SANTIYE ADRESI")
        rep.pafta_ada_parsel = _find_field(text, norm, "PAFTA / ADA / PARSEL",
                                           "PAFTA/ADA/PARSEL")
        rep.yapi_elemani = _find_field(text, norm, "YAPI ELEMANI")
        rep.kat_kot_blok = _find_field(text, norm, "KAT/KOT/BLOK",
                                       "KAT / KOT / BLOK")
        rep.numune_boyut_sekil = _find_field(text, norm,
                                             "NUMUNENIN BOYUTU - SEKLI",
                                             "NUMUNENIN BOYUTU")
        rep.alinis_tarihi = _to_iso(_find_field(text, norm,
                                                "NUMUNENIN ALINIS TARIHI"))
        rep.lab_gelis_tarihi = _to_iso(_find_field(
            text, norm, "NUMUNENIN LAB. GELIS TARIHI",
            "NUMUNENIN LAB.GELIS TARIHI"))
        rep.deney_tarihi = _to_iso(_find_field(text, norm,
                                               "DENEY TARIHI 28 GUN"))

        # Beton sınıfı ve miktarı ("C35/45 - 600")
        raw_cls = _find_field(text, norm, "BETON SINIFI-MIKTARI",
                              "BETON SINIFI - MIKTARI", "BETON SINIFI") or ""
        m = re.search(r"C\s*(\d{1,3})\s*/\s*(\d{1,3})", raw_cls) or \
            re.search(r"C\s*(\d{1,3})\s*/\s*(\d{1,3})", norm)
        if m:
            rep.beton_sinifi = f"C{m.group(1)}/{m.group(2)}"
        m = re.search(r"[-–]\s*([\d.,]+)\s*$", raw_cls.strip()) or \
            re.search(r"[-–]\s*([\d.,]+)", raw_cls)
        if m:
            rep.beton_miktari_m3 = _to_float(m.group(1))

        adet = _find_field(text, norm, "ALINAN NUMUNE ADEDI")
        if adet:
            m = re.search(r"\d+", adet)
            if m:
                rep.alinan_numune_adedi = int(m.group(0))

        # Laboratuvar adı: başlıktaki "BETON DENEY RAPORU" ile ilk etiket
        # satırı arasındaki satırlar
        lab_lines: list[str] = []
        seen_title = False
        for ln in pages_text[0].splitlines()[:8]:
            n = _norm(ln)
            if "BETON DENEY RAPORU" in n:
                seen_title = True
                continue
            if _LABEL_RE.search(n):
                break
            if seen_title and ln.strip():
                lab_lines.append(ln.strip())
        if lab_lines:
            rep.lab_adi = " ".join(lab_lines)[:120]

        m = re.search(r"(\d+)\s*SAYILI\s*LABORATUVAR IZIN BELGE", norm)
        if m:
            rep.lab_izin_belge_no = m.group(1)

        # Sonuç esası: "eşdeğer" dipnotu
        for ln in norm.splitlines():
            if "ESDEGER" in ln:
                flat = ln.replace(" ", "")
                if "150*300" in flat or "150X300" in flat or "SILINDIR" in ln:
                    rep.sonuc_esasi = "silindir"
                elif "KUP" in ln:
                    rep.sonuc_esasi = "kup"
                break
        if rep.sonuc_esasi is None:
            notes.append("Sonuçların esası (silindir/küp eşdeğeri) PDF'ten "
                         "belirlenemedi — raporun dipnotuna bakarak elle seçin.")

        # Numune sonuçları
        raw_rows = _parse_tables(pdf, notes)
        if not raw_rows:
            raw_rows = _parse_text_rows(pdf, notes)
        if not raw_rows:
            notes.append("Numune sonuç tablosu okunamadı — değerleri elle girin.")

        groups: dict[str, ExtractedGroup] = {}
        seen_kalip: set[str] = set()
        for group, kalip, value, beyan, olc_mm in raw_rows:
            if kalip in seen_kalip:
                continue
            seen_kalip.add(kalip)
            g = groups.get(group)
            if g is None:
                g = ExtractedGroup(group_no=group, values=[])
                groups[group] = g
            g.values.append(value)
            if beyan and not g.slump_class:
                g.slump_class = beyan
            if olc_mm is not None and g.slump_measured_mm is None:
                g.slump_measured_mm = olc_mm
        rep.gruplar = list(groups.values())
        rep.okuma_notlari = notes
        return rep


def extract_report(files: list[tuple[str, bytes]]) -> ExtractedReport:
    """files: [(dosya_adı, içerik), ...] — yalnızca PDF desteklenir."""
    if not files:
        raise ExtractionError("Dosya yüklenmedi.")

    pdfs = [(n, d) for n, d in files if n.lower().endswith(".pdf")]
    others = [n for n, _ in files if not n.lower().endswith(".pdf")]
    notes: list[str] = []
    if others:
        notes.append(
            "Fotoğraf/görüntü dosyaları otomatik okunamıyor (ücretsiz sürüm "
            "yalnızca dijital PDF okur): " + ", ".join(others) +
            ". Bu belgelerdeki verileri elle girin.")
    if not pdfs:
        raise ExtractionError(
            "Otomatik okuma yalnızca metin katmanlı (dijital) PDF raporlarda "
            "yapılabilir. Fotoğraflardaki verileri lütfen elle girin.")

    result: Optional[ExtractedReport] = None
    for name, data in pdfs:
        try:
            rep = _parse_pdf(data, notes)
        except ExtractionError as exc:
            notes.append(f"{name}: {exc}")
            continue
        if result is None:
            result = rep
        else:
            existing = {g.group_no for g in result.gruplar}
            for g in rep.gruplar:
                if g.group_no not in existing:
                    result.gruplar.append(g)
            for f in ("rapor_no", "yibf_no", "beton_sinifi", "beton_miktari_m3",
                      "alinis_tarihi", "deney_tarihi", "sonuc_esasi"):
                if getattr(result, f) is None and getattr(rep, f) is not None:
                    setattr(result, f, getattr(rep, f))
    if result is None:
        raise ExtractionError("Yüklenen PDF'lerden veri çıkarılamadı. " +
                              " | ".join(notes))
    result.okuma_notlari = notes
    return result
