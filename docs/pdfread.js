/*
 * Beton deney raporu PDF'inden tamamen yerel veri çıkarma (pdf.js metin
 * katmanı üzerinden). Hiçbir veri bilgisayardan çıkmaz.
 *
 * Bu modül SAF çözümleme fonksiyonları içerir; pdf.js yüklemesi app.js
 * tarafında yapılır. Böylece aynı mantık Node testlerinde de doğrulanır.
 */
"use strict";

const TR_MAP = {
  "İ": "I", "ı": "i", "Ş": "S", "ş": "s", "Ğ": "G", "ğ": "g",
  "Ü": "U", "ü": "u", "Ö": "O", "ö": "o", "Ç": "C", "ç": "c",
};

export function norm(s) {
  return String(s).replace(/[İıŞşĞğÜüÖöÇç]/g, (c) => TR_MAP[c]).toUpperCase();
}

const LABELS = [
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
];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const LABEL_RE = new RegExp(
  [...LABELS].sort((a, b) => b.length - a.length).map(escapeRe).join("|"), "g");

const DATE_RE = /(\d{1,2})[./](\d{1,2})[./](\d{4})/;
// Kalıp no: "7-2" gibi (rapor no'daki "B601-28-23" benzeri dizileri dışlamak
// için sayı öncesi/sonrası kontrolü yapılır)
const KALIP_RE = /(?<![\d-])(\d{1,3})\s*-\s*(\d{1,2})(?![\d-])/;

function findField(text, normText, ...labels) {
  for (const label of labels) {
    const m = new RegExp(escapeRe(label) + "\\s*:?").exec(normText);
    if (!m) continue;
    const start = m.index + m[0].length;
    let nl = normText.indexOf("\n", start);
    if (nl === -1) nl = normText.length;
    LABEL_RE.lastIndex = start;
    const nxt = LABEL_RE.exec(normText);
    const end = nxt && nxt.index < nl ? nxt.index : nl;
    const value = text.slice(start, end).replace(/^[\s:]+|[\s:]+$/g, "");
    if (value) return value;
  }
  return null;
}

function toIso(value) {
  if (!value) return null;
  const m = DATE_RE.exec(value);
  if (!m) return null;
  return `${m[3]}-${String(+m[2]).padStart(2, "0")}-${String(+m[1]).padStart(2, "0")}`;
}

function numTr(s) {
  if (s === null || s === undefined) return null;
  let t = String(s).trim();
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const v = Number(t);
  return Number.isNaN(v) ? null : v;
}

function strength(v) {
  // 5 MPa alt sınırı: grafik ekseni etiketleri (1,0 ... 4,0) gibi rapor
  // süslemelerinin dayanım değeri sanılmasını engeller.
  return v !== null && v >= 5 && v <= 150 ? v : null;
}

/* ------------------------------------------------------------------ */
/* pdf.js metin öğelerinden satır kurma                                 */
/* ------------------------------------------------------------------ */
/** items: pdf.js getTextContent().items — y konumuna göre satırlara ayır. */
export function linesFromTextContent(items) {
  const rows = new Map(); // yKey -> [{x, str}]
  for (const it of items) {
    const str = (it.str || "").trim();
    if (!str) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    const yKey = Math.round(y / 3) * 3; // ~3pt tolerans
    if (!rows.has(yKey)) rows.set(yKey, []);
    rows.get(yKey).push({ x, str });
  }
  const keys = [...rows.keys()].sort((a, b) => b - a); // yukarıdan aşağı
  return keys.map((k) =>
    rows.get(k).sort((a, b) => a.x - b.x).map((o) => o.str).join(" ")
      .replace(/\s+/g, " ").trim());
}

/* ------------------------------------------------------------------ */
/* Satırlardan numune gruplarını çıkarma                                */
/* ------------------------------------------------------------------ */
function parseSpecimenRows(allLines, notes, ocr = false) {
  const rows = [];
  // 28 günlük dayanım: tek ondalık basamaklı, virgüllü sayı.
  // (Kırılma yükü 2, yoğunluk 3 ondalıklı olduğundan karışmaz.)
  // OCR modunda virgül sıkça nokta okunduğundan nokta da kabul edilir;
  // ≥5 MPa alt sınırı "1.0" gibi süsleme sayılarını yine eler.
  const candRe = ocr ? /(?<![\d.,])(\d{1,3}[.,]\d)(?![\d])/g
                     : /(?<![\d.,])(\d{1,3},\d)(?![\d])/g;
  for (const line of allLines) {
    const m = KALIP_RE.exec(line);
    if (!m) continue;
    // Gerçek kalıp numarasında numune sırası küçüktür (örn. 7-2); "10 - 40"
    // gibi çökme sınıfı aralıkları böylece elenir.
    if (Number(m[2]) > 12) continue;
    const tail = line.slice(m.index + m[0].length);
    const cands = [...tail.matchAll(candRe)]
      .map((c) => strength(numTr(c[1].replace(".", ","))))
      .filter((v) => v !== null);
    if (!cands.length) continue;
    const group = m[1];
    const kalip = `${m[1]}-${m[2]}`;
    let slumpClass = null, slumpMm = null;
    const sm = /\bS([1-5])\b(?:\s+(\d{1,3})\b)?/.exec(tail) ||
               /\bS([1-5])\b(?:\s+(\d{1,3})\b)?/.exec(line.slice(0, m.index));
    if (sm) {
      slumpClass = "S" + sm[1];
      if (sm[2] !== undefined) {
        const v = Number(sm[2]);
        if (v > 0) slumpMm = v <= 35 ? v * 10 : v; // cm -> mm dönüşümü
      }
    }
    rows.push({ group, kalip, value: cands[0], slumpClass, slumpMm });
  }
  if (!rows.length) {
    notes.push("Numune sonuç satırları okunamadı — değerleri elle girin.");
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* Ana çözümleme                                                       */
/* ------------------------------------------------------------------ */
/**
 * pages: her sayfa için satır dizisi (string[][]).
 * opts.ocr: satırlar OCR'dan geldiyse true (toleranslar gevşetilir).
 * Dönen nesne app tarafındaki form alanlarıyla eşleşir.
 */
export function parseReportFromPages(pages, opts = {}) {
  const ocr = Boolean(opts.ocr);
  const notes = [];
  const allLines = pages.flat();
  const text = allLines.join("\n");
  if (text.trim().length < 40) {
    throw new Error(
      "PDF'te okunabilir metin katmanı yok (muhtemelen tarama/fotoğraf).");
  }
  const normText = norm(text);

  const rep = {
    rapor_no: findField(text, normText, "RAPOR NO"),
    yibf_no: findField(text, normText, "YIBF NUMARASI", "YIBF NO"),
    deney_isteyen: findField(text, normText, "DENEY ISTEYEN FIRMA"),
    muteahhit: findField(text, normText, "MUTEAHHIT FIRMA"),
    yapi_sahibi: findField(text, normText, "YAPI SAHIBI"),
    uretici_firma: findField(text, normText, "URETICI FIRMA"),
    santiye_adresi: findField(text, normText, "SANTIYE ADRESI"),
    pafta_ada_parsel: findField(text, normText, "PAFTA / ADA / PARSEL",
                                "PAFTA/ADA/PARSEL"),
    yapi_elemani: findField(text, normText, "YAPI ELEMANI"),
    kat_kot_blok: findField(text, normText, "KAT/KOT/BLOK", "KAT / KOT / BLOK"),
    numune_boyut_sekil: findField(text, normText, "NUMUNENIN BOYUTU - SEKLI",
                                  "NUMUNENIN BOYUTU"),
    alinis_tarihi: toIso(findField(text, normText, "NUMUNENIN ALINIS TARIHI")),
    lab_gelis_tarihi: toIso(findField(text, normText,
                                      "NUMUNENIN LAB. GELIS TARIHI",
                                      "NUMUNENIN LAB.GELIS TARIHI")),
    deney_tarihi: toIso(findField(text, normText, "DENEY TARIHI 28 GUN")),
    beton_sinifi: null, beton_miktari_m3: null, alinan_numune_adedi: null,
    lab_adi: null, lab_izin_belge_no: null, sonuc_esasi: null,
    gruplar: [], okuma_notlari: notes,
  };

  // Beton sınıfı ve miktarı ("C35/45 - 600")
  const rawCls = findField(text, normText, "BETON SINIFI-MIKTARI",
                           "BETON SINIFI - MIKTARI", "BETON SINIFI") || "";
  let m = /C\s*(\d{1,3})\s*\/\s*(\d{1,3})/.exec(rawCls) ||
          /C\s*(\d{1,3})\s*\/\s*(\d{1,3})/.exec(normText);
  if (m) rep.beton_sinifi = `C${m[1]}/${m[2]}`;
  m = /[-–]\s*([\d.,]+)\s*$/.exec(rawCls.trim()) || /[-–]\s*([\d.,]+)/.exec(rawCls);
  if (m) rep.beton_miktari_m3 = numTr(m[1]);

  const adet = findField(text, normText, "ALINAN NUMUNE ADEDI");
  if (adet) {
    m = /\d+/.exec(adet);
    if (m) rep.alinan_numune_adedi = parseInt(m[0], 10);
  }

  // Laboratuvar adı: ilk sayfada başlık ile ilk etiket arası satırlar
  const labLines = [];
  let seenTitle = false;
  for (const ln of (pages[0] || []).slice(0, 8)) {
    const n = norm(ln);
    if (n.includes("BETON DENEY RAPORU")) { seenTitle = true; continue; }
    LABEL_RE.lastIndex = 0;
    if (LABEL_RE.test(n)) break;
    if (seenTitle && ln.trim()) labLines.push(ln.trim());
  }
  if (labLines.length) rep.lab_adi = labLines.join(" ").slice(0, 120);

  m = /(\d+)\s*SAYILI\s*LABORATUVAR IZIN BELGE/.exec(normText);
  if (m) rep.lab_izin_belge_no = m[1];

  // Sonuç esası: "eşdeğer" dipnotu
  for (const ln of normText.split("\n")) {
    if (ln.includes("ESDEGER")) {
      const flat = ln.replace(/\s+/g, "");
      if (flat.includes("150*300") || flat.includes("150X300") ||
          ln.includes("SILINDIR")) rep.sonuc_esasi = "silindir";
      else if (ln.includes("KUP")) rep.sonuc_esasi = "kup";
      break;
    }
  }
  if (!rep.sonuc_esasi) {
    notes.push("Sonuçların esası (silindir/küp eşdeğeri) PDF'ten " +
               "belirlenemedi — raporun dipnotuna bakarak elle seçin.");
  }

  // Numune grupları
  const rawRows = parseSpecimenRows(allLines, notes, ocr);
  const groups = new Map();
  const seenKalip = new Set();
  for (const r of rawRows) {
    if (seenKalip.has(r.kalip)) continue;
    seenKalip.add(r.kalip);
    if (!groups.has(r.group)) {
      groups.set(r.group, {
        group_no: r.group, values: [], slump_class: null, slump_measured_mm: null,
      });
    }
    const g = groups.get(r.group);
    g.values.push(r.value);
    if (r.slumpClass && !g.slump_class) g.slump_class = r.slumpClass;
    if (r.slumpMm !== null && g.slump_measured_mm === null) {
      g.slump_measured_mm = r.slumpMm;
    }
  }
  rep.gruplar = [...groups.values()];
  if (rep.gruplar.length) {
    notes.push(ocr
      ? "Belge OCR (optik karakter tanıma) ile okunmuştur; yanlış okuma " +
        "olasılığı yüksektir — TÜM değerleri laboratuvar raporuyla tek tek " +
        "karşılaştırın."
      : "Değerler satır düzeninden okunmuştur — laboratuvar raporuyla " +
        "mutlaka karşılaştırın.");
  }
  return rep;
}
