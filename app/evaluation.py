# -*- coding: utf-8 -*-
"""
Beton basınç dayanımı değerlendirme motoru.

Dayanaklar:
- TS 500 (Şubat 2000) madde 3.4 — 26.10.2002 tadili ile TS EN 206 denetim
  kriterlerine atıf yapar. Yapı denetim uygulamasında laboratuvar raporlarında
  basılan denetim kriterleri tablosu:
      n = 1     : 1. kriter uygulanamaz, tek sonuç fci >= fck
      n = 2..4  : fcm >= fck + 1.0   ve   her fci >= fck - 4.0
      n >= 5    : fcm >= fck + 2.0   ve   her fci >= fck - 4.0
- TS 13515 Ek B1 — aynı numune takımı (grup) içindeki en büyük ve en küçük
  tekil sonuç farkı, grup ortalamasının %15'ini aşarsa en düşük değer atılır,
  kalan sonuçlarla yeniden kontrol edilir; yine aşıyorsa grup sonucu geçersiz.
- TS EN 206 Çizelge 14 (bilgi amaçlı ek değerlendirme):
  başlangıç imalatı: fcm >= fck + 4 ; her fci >= fck - 4.
- Çökme (slump) sınıfları TS EN 206: S1 10-40, S2 50-90, S3 100-150,
  S4 160-210, S5 >= 220 mm (sapma ±10 mm).

Tüm hesaplar deterministiktir; hiçbir değerlendirme LLM'e bırakılmaz.
Karşılaştırmalar 0,1 MPa hassasiyetine yuvarlanarak yapılır (laboratuvar
raporlama hassasiyeti).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from math import ceil
from typing import Optional

# TS EN 206 basınç dayanım sınıfları: sınıf -> (fck silindir, fck küp) [MPa]
CONCRETE_CLASSES: dict[str, tuple[int, int]] = {
    "C8/10": (8, 10),
    "C12/15": (12, 15),
    "C16/20": (16, 20),
    "C20/25": (20, 25),
    "C25/30": (25, 30),
    "C30/37": (30, 37),
    "C35/45": (35, 45),
    "C40/50": (40, 50),
    "C45/55": (45, 55),
    "C50/60": (50, 60),
    "C55/67": (55, 67),
    "C60/75": (60, 75),
    "C70/85": (70, 85),
    "C80/95": (80, 95),
    "C90/105": (90, 105),
    "C100/115": (100, 115),
}

# TS EN 206 çökme sınıfları [mm] ve sınıf sınırlarında izin verilen sapma
SLUMP_CLASSES: dict[str, tuple[int, Optional[int]]] = {
    "S1": (10, 40),
    "S2": (50, 90),
    "S3": (100, 150),
    "S4": (160, 210),
    "S5": (220, None),
}
SLUMP_TOLERANCE_MM = 10

EK_B1_RATIO = 0.15  # TS 13515 Ek B1 %15 kuralı


def _r1(x: float) -> float:
    """0,1 MPa hassasiyetine yuvarla (laboratuvar raporlama hassasiyeti)."""
    return round(x + 1e-9, 1)


def parse_concrete_class(text: str) -> str:
    """'c35/45', 'C 35 / 45' gibi girdileri 'C35/45' anahtarına çevirir."""
    if not text:
        raise ValueError("Beton sınıfı boş olamaz.")
    key = text.upper().replace(" ", "").replace("İ", "I")
    if not key.startswith("C"):
        key = "C" + key
    if key in CONCRETE_CLASSES:
        return key
    # 'C35' gibi tek değerli girişte silindir dayanımından eşleştir
    if "/" not in key:
        try:
            fck = int(key[1:])
        except ValueError:
            raise ValueError(f"Beton sınıfı çözümlenemedi: {text!r}")
        for name, (cyl, _cube) in CONCRETE_CLASSES.items():
            if cyl == fck:
                return name
    raise ValueError(f"Bilinmeyen beton sınıfı: {text!r}")


@dataclass
class GroupResult:
    """Bir numune grubunun (aynı mikser/harman) TS 13515 Ek B1 kontrolü."""

    group_no: str
    values: list[float]                    # girilen tekil sonuçlar (MPa)
    n_specimens: int = 0
    mean_initial: Optional[float] = None   # ilk ortalama
    range_initial: Optional[float] = None  # max - min
    limit_initial: Optional[float] = None  # 0,15 x ortalama
    within_limit: bool = True              # ilk kontrol %15 içinde mi
    discarded_value: Optional[float] = None
    values_used: list[float] = field(default_factory=list)
    mean_final: Optional[float] = None     # geçerli grup sonucu fci (MPa)
    range_final: Optional[float] = None
    limit_final: Optional[float] = None
    valid: bool = False
    note: str = ""


def evaluate_group(group_no: str, values: list[float]) -> GroupResult:
    """TS 13515 Ek B1 grup içi tutarlılık kontrolü."""
    vals = [float(v) for v in values if v is not None]
    g = GroupResult(group_no=str(group_no), values=vals, n_specimens=len(vals))

    if not vals:
        g.valid = False
        g.note = "Numune sonucu girilmemiş."
        return g

    if any(v <= 0 for v in vals):
        g.valid = False
        g.note = "Sıfır veya negatif dayanım değeri girilemez."
        return g

    if len(vals) == 1:
        g.mean_initial = g.mean_final = _r1(vals[0])
        g.values_used = vals
        g.valid = True
        g.note = "Tek numune — grup içi %15 kontrolü uygulanamaz."
        return g

    mean0 = sum(vals) / len(vals)
    rng0 = max(vals) - min(vals)
    lim0 = EK_B1_RATIO * mean0
    g.mean_initial = _r1(mean0)
    g.range_initial = _r1(rng0)
    g.limit_initial = _r1(lim0)
    g.within_limit = rng0 <= lim0 + 1e-9

    if g.within_limit:
        g.values_used = vals
        g.mean_final = _r1(mean0)
        g.valid = True
        g.note = "Fark ortalamanın %15'i içinde — sonuçlar geçerli."
        return g

    if len(vals) == 2:
        g.valid = False
        g.note = ("İki numune arasındaki fark ortalamanın %15'ini aşıyor — "
                  "TS 13515 Ek B1 gereği grup sonuçları geçersiz.")
        return g

    # 3 (veya daha fazla) numune: en düşük değer atılır, kalanla tekrar kontrol
    discarded = min(vals)
    remaining = sorted(vals)
    remaining.remove(discarded)
    g.discarded_value = discarded
    mean1 = sum(remaining) / len(remaining)
    rng1 = max(remaining) - min(remaining)
    lim1 = EK_B1_RATIO * mean1
    g.range_final = _r1(rng1)
    g.limit_final = _r1(lim1)

    if rng1 <= lim1 + 1e-9:
        g.values_used = remaining
        g.mean_final = _r1(mean1)
        g.valid = True
        g.note = (f"Fark %15 sınırını aştığından en düşük değer ({discarded:.1f} MPa) "
                  "atıldı; kalan sonuçlar geçerli (TS 13515 Ek B1).")
    else:
        g.values_used = []
        g.valid = False
        g.note = ("En düşük değer atıldıktan sonra da fark ortalamanın %15'ini "
                  "aşıyor — grup sonuçları geçersiz (TS 13515 Ek B1).")
    return g


@dataclass
class CriterionResult:
    label: str
    applicable: bool
    passed: Optional[bool]
    detail: str
    threshold: Optional[float] = None
    value: Optional[float] = None


@dataclass
class SlumpResult:
    group_no: str
    declared_class: str
    measured_mm: float
    lower_mm: Optional[float] = None
    upper_mm: Optional[float] = None
    passed: Optional[bool] = None
    detail: str = ""


@dataclass
class EvaluationResult:
    concrete_class: str
    basis: str                       # 'silindir' | 'kup'
    fck: float                       # değerlendirmede kullanılan fck
    fck_cylinder: float
    fck_cube: float
    groups: list[GroupResult] = field(default_factory=list)
    n_valid: int = 0
    n_invalid: int = 0
    fcm: Optional[float] = None
    fci_min: Optional[float] = None
    criterion1: Optional[CriterionResult] = None
    criterion2: Optional[CriterionResult] = None
    ts500_conform: Optional[bool] = None
    en206_initial: Optional[CriterionResult] = None   # bilgi amaçlı
    slump_results: list[SlumpResult] = field(default_factory=list)
    age_days: Optional[int] = None
    warnings: list[str] = field(default_factory=list)
    recommendations: list[str] = field(default_factory=list)
    verdict: str = ""                # 'UYGUN' | 'UYGUN DEĞİL' | 'DEĞERLENDİRİLEMEDİ'


def evaluate_slump(group_no: str, declared_class: str,
                   measured_mm: float) -> SlumpResult:
    s = SlumpResult(group_no=str(group_no),
                    declared_class=str(declared_class).upper().strip(),
                    measured_mm=float(measured_mm))
    cls = SLUMP_CLASSES.get(s.declared_class)
    if cls is None:
        s.passed = None
        s.detail = f"Bilinmeyen çökme sınıfı: {declared_class!r}"
        return s
    lo, hi = cls
    s.lower_mm = lo - SLUMP_TOLERANCE_MM
    s.upper_mm = (hi + SLUMP_TOLERANCE_MM) if hi is not None else None
    ok_low = s.measured_mm >= s.lower_mm
    ok_high = True if s.upper_mm is None else s.measured_mm <= s.upper_mm
    s.passed = ok_low and ok_high
    rng = f"{lo}-{hi} mm" if hi is not None else f">= {lo} mm"
    s.detail = (f"{s.declared_class} sınıfı ({rng}, sapma ±{SLUMP_TOLERANCE_MM} mm) "
                f"için ölçülen {s.measured_mm:.0f} mm "
                + ("uygun." if s.passed else "uygun değil."))
    return s


def evaluate(
    concrete_class: str,
    basis: str,
    groups: list[dict],
    *,
    volume_m3: Optional[float] = None,
    sampling_date: Optional[date] = None,
    test_date: Optional[date] = None,
) -> EvaluationResult:
    """
    Ana değerlendirme.

    groups: [{"group_no": "1", "values": [44.8, 40.0, 45.8],
              "slump_class": "S4", "slump_measured_mm": 150}, ...]
    basis:  'silindir' -> sonuçlar 150x300 silindir eşdeğeri, fck = silindir fck
            'kup'      -> sonuçlar 150 mm küp eşdeğeri,       fck = küp fck
    """
    cls = parse_concrete_class(concrete_class)
    fck_cyl, fck_cube = CONCRETE_CLASSES[cls]
    basis_norm = str(basis).strip().lower()
    if basis_norm in ("silindir", "cylinder", "cyl"):
        basis_norm, fck = "silindir", float(fck_cyl)
    elif basis_norm in ("kup", "küp", "cube"):
        basis_norm, fck = "kup", float(fck_cube)
    else:
        raise ValueError(f"Değerlendirme esası 'silindir' veya 'kup' olmalı: {basis!r}")

    res = EvaluationResult(
        concrete_class=cls, basis=basis_norm, fck=fck,
        fck_cylinder=float(fck_cyl), fck_cube=float(fck_cube),
    )

    for i, gdict in enumerate(groups, start=1):
        gno = str(gdict.get("group_no") or i)
        g = evaluate_group(gno, gdict.get("values") or [])
        res.groups.append(g)
        sl_cls = gdict.get("slump_class")
        sl_mm = gdict.get("slump_measured_mm")
        if sl_cls and sl_mm is not None:
            res.slump_results.append(evaluate_slump(gno, sl_cls, float(sl_mm)))

    valid = [g for g in res.groups if g.valid]
    invalid = [g for g in res.groups if not g.valid]
    res.n_valid, res.n_invalid = len(valid), len(invalid)

    for g in invalid:
        res.warnings.append(
            f"Grup {g.group_no}: sonuç geçersiz — {g.note}")

    n = res.n_valid
    if n == 0:
        res.verdict = "DEĞERLENDİRİLEMEDİ"
        res.warnings.append("Geçerli grup sonucu bulunmadığından basınç dayanımı "
                            "uygunluk değerlendirmesi yapılamadı.")
        res.recommendations.append(
            "Geçerli deney sonucu elde edilemediğinden, ilgili fenni mesulün "
            "talebiyle yapıdaki beton dayanımı TS EN 13791 kapsamında karot ve "
            "tahribatsız yöntemlerle belirlenmelidir.")
        return res

    fcis = [g.mean_final for g in valid]
    res.fcm = _r1(sum(fcis) / n)
    res.fci_min = _r1(min(fcis))

    # --- 1. Kriter (ortalama) ---
    if n == 1:
        res.criterion1 = CriterionResult(
            label="1. Kriter (fcm)", applicable=False, passed=None,
            detail="n = 1 olduğundan 1. kriter uygulanamaz (TS 500 m.3.4).")
    else:
        margin = 1.0 if n <= 4 else 2.0
        thr = _r1(fck + margin)
        ok = res.fcm >= thr - 1e-9
        res.criterion1 = CriterionResult(
            label="1. Kriter (fcm)", applicable=True, passed=ok,
            threshold=thr, value=res.fcm,
            detail=(f"n = {n} için fcm >= fck + {margin:.0f} → "
                    f"{res.fcm:.1f} MPa {'≥' if ok else '<'} {thr:.1f} MPa"))

    # --- 2. Kriter (tekil sonuçlar) ---
    if n == 1:
        thr2 = _r1(fck)
        label2 = "fci >= fck"
    else:
        thr2 = _r1(fck - 4.0)
        label2 = "fci >= fck - 4"
    failing = [g for g in valid if g.mean_final < thr2 - 1e-9]
    ok2 = not failing
    fail_txt = ""
    if failing:
        fail_txt = " Sağlamayan gruplar: " + ", ".join(
            f"{g.group_no} ({g.mean_final:.1f} MPa)" for g in failing)
    res.criterion2 = CriterionResult(
        label="2. Kriter (fci)", applicable=True, passed=ok2,
        threshold=thr2, value=res.fci_min,
        detail=(f"{label2} → en düşük grup sonucu {res.fci_min:.1f} MPa "
                f"{'≥' if ok2 else '<'} {thr2:.1f} MPa.{fail_txt}"))

    c1_ok = (res.criterion1.passed is not False)  # n=1'de uygulanamaz → engel değil
    res.ts500_conform = bool(c1_ok and ok2)
    res.verdict = "UYGUN" if res.ts500_conform else "UYGUN DEĞİL"

    # --- TS EN 206 Çizelge 14 başlangıç imalat kriteri (bilgi amaçlı) ---
    if n >= 3:
        thr_i = _r1(fck + 4.0)
        ok_i = res.fcm >= thr_i - 1e-9 and res.fci_min >= _r1(fck - 4.0) - 1e-9
        res.en206_initial = CriterionResult(
            label="TS EN 206 Çizelge 14 (başlangıç imalatı — bilgi amaçlı)",
            applicable=True, passed=ok_i, threshold=thr_i, value=res.fcm,
            detail=(f"fcm >= fck + 4 ve fci >= fck - 4 → fcm {res.fcm:.1f} MPa, "
                    f"en düşük fci {res.fci_min:.1f} MPa "
                    f"({'sağlanıyor' if ok_i else 'sağlanmıyor'})."))

    # --- Numune yaşı kontrolü ---
    if sampling_date and test_date:
        age = (test_date - sampling_date).days
        res.age_days = age
        if age != 28:
            res.warnings.append(
                f"Numune yaşı {age} gün — 28 günlük standart deney yaşından "
                "farklı. Değerlendirme 28 günlük dayanım esasına göredir "
                "(TS EN 12390-3).")

    # --- Numune sayısı bilgilendirmesi (TS 500 m.3.4) ---
    if volume_m3 and volume_m3 > 0:
        expected = max(3, ceil(volume_m3 / 100.0))
        if len(res.groups) < expected:
            res.warnings.append(
                f"{volume_m3:.0f} m³ beton için TS 500 m.3.4 esasına göre en az "
                f"{expected} grup (her 100 m³ veya 450 m² döşeme için 1 grup, "
                f"işte en az 3 grup) beklenir; raporda {len(res.groups)} grup var.")

    # --- Çökme uygunsuzlukları ---
    for s in res.slump_results:
        if s.passed is False:
            res.warnings.append(f"Grup {s.group_no}: çökme (slump) {s.detail}")

    # --- Öneriler ---
    if not res.ts500_conform:
        res.recommendations += [
            "Basınç dayanımı sonuçları TS 500 m.3.4 / TS EN 206 denetim "
            "kriterlerini sağlamamaktadır. İlgili idareye ve yapı denetim "
            "kuruluşu denetçi mimar/mühendisine yazılı bildirim yapılmalıdır.",
            "İlgili fenni mesulün talebiyle yapıdaki beton dayanımı TS EN 13791 "
            "kapsamında belirlenmelidir: yapıya zarar vermeyecek noktalardan "
            "karot alınması ve/veya TS 13543 kapsamındaki tahribatsız (beton "
            "çekici, ultrases vb.) yöntemlerle değerlendirme yapılması önerilir.",
            "Karot değerlendirmesinde şüpheli bölge için yaygın uygulama: "
            "en düşük karot dayanımının 0,85·(fck − 4) değerinden büyük olması "
            "koşulunun kontrolü (TS EN 13791 / 2019 yaklaşımı).",
            "Uygunsuz beton dökümüne devam edilmemeli; üretici firmanın G "
            "uygunluk belgesi kapsamındaki üretim kontrol kayıtları istenmelidir.",
        ]
    if res.n_invalid:
        res.recommendations.append(
            "Geçersiz grup sonuçları için numune alma, saklama, kür ve deney "
            "süreçleri (TS EN 12350-1, TS EN 12390-2) gözden geçirilmeli; "
            "gerekirse laboratuvardan açıklama istenmelidir.")
    return res
