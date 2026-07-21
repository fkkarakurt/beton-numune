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
/* Satırlardan numune gruplarını çıkarma (metin katmanlı PDF)           */
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
    // gibi aralık gösterimleri böylece elenir.
    if (Number(m[2]) > 12) continue;
    const tail = line.slice(m.index + m[0].length);
    const cands = [...tail.matchAll(candRe)]
      .map((c) => strength(numTr(c[1].replace(".", ","))))
      .filter((v) => v !== null);
    if (!cands.length) continue;
    rows.push({ group: m[1], kalip: `${m[1]}-${m[2]}`, value: cands[0] });
  }
  if (!rows.length) {
    notes.push("Numune sonuç satırları okunamadı — değerleri elle girin.");
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* OCR kelime konumlarından tablo geri-çatımı                           */
/* ------------------------------------------------------------------ */
/*
 * Satır metni yerine kelime sınır kutuları (bbox) kullanılır: "28 Günlük
 * Numune" sütununun x-aralığı başlıktan (yoksa sütun konsensüsünden)
 * belirlenir ve her kalıp satırında yalnız o aralığa düşen kelimeler değer
 * sayılır. Böylece grup ortalaması / 7 günlük / ağırlık sütunları değer
 * sanılmaz ve bozuk okunan hücreler ("47 A" = 47,4) kurtarılabilir.
 */

// OCR'ın sayısal bağlamda rakam yerine okuduğu karakterler
const DIGIT_FIX = {
  O: "0", o: "0", Q: "0", S: "5", s: "5", B: "8", A: "4", Z: "2", z: "2",
  G: "6", I: "1", l: "1", "|": "1", "!": "1", "İ": "1", i: "1", "ı": "1",
};
const fixDigits = (t) => String(t).replace(/./g, (c) => DIGIT_FIX[c] ?? c);

/** Sayısal sütun hücresini dayanım değerine çevirir (5–150 MPa, 1 ondalık). */
export function normStrengthToken(txt) {
  const raw = String(txt).trim();
  // Tire/oran/saat içeren belirteçler değer değildir ("8-3" kalıp, "14:25",
  // "C55/67"); tek rakamlık belirteçler de gürültüdür (mikser no, adet...).
  if (/[-–—/:;]/.test(raw)) return null;
  let t = fixDigits(raw).replace(/[^0-9.,]/g, "").replace(/^[.,]+|[.,]+$/g, "");
  if ((t.match(/\d/g) || []).length < 2) return null;
  let v = null;
  const m = /^(\d{1,3})[.,](\d+)$/.exec(t);
  if (m) {
    // "45.44" gibi fazla haneli okumalarda ilk ondalık hane esas alınır
    v = Number(m[1]) + Number(m[2][0]) / 10;
  } else if (/^\d+$/.test(t)) {
    if (t.length <= 2) v = Number(t);                       // ayraç kaybolmuş
    else if (t.length <= 4) v = Number(t.slice(0, -1)) + Number(t.at(-1)) / 10;
    else return null;
  } else {
    return null;
  }
  return v >= 5 && v <= 150 ? Math.round(v * 10) / 10 : null;
}

const KALIP_WORD_RE = /^(\d{1,3})[-–—](\d{1,2})$/;

function kalipFromToken(txt) {
  const t = fixDigits(String(txt).trim())
    .replace(/\s+/g, "").replace(/^[^0-9]+|[^0-9]+$/g, "");
  const m = KALIP_WORD_RE.exec(t);
  if (!m || Number(m[2]) > 12 || Number(m[1]) < 1) return null;
  return { group: m[1], spec: m[2] };
}

const cx = (w) => (w.bbox.x0 + w.bbox.x1) / 2;
const cy = (b) => (b.y0 + b.y1) / 2;

/** Tesseract satırlarını fiziksel tablo satırlarına birleştirir. */
export function rowsFromOcrLines(lines) {
  const usable = (lines || []).filter((l) => l && l.words && l.words.length &&
                                             l.bbox);
  const sorted = [...usable].sort((a, b) => cy(a.bbox) - cy(b.bbox));
  const rows = [];
  for (const ln of sorted) {
    const last = rows[rows.length - 1];
    if (last) {
      const ha = last.bbox.y1 - last.bbox.y0, hb = ln.bbox.y1 - ln.bbox.y0;
      const ov = Math.min(last.bbox.y1, ln.bbox.y1) -
                 Math.max(last.bbox.y0, ln.bbox.y0);
      // Tablo çizgisi gibi aşırı yüksek "satırlar" birleştirme zinciri
      // kurmasın diye yükseklikler karşılaştırılabilir olmalı
      if (ov > 0.55 * Math.min(ha, hb) &&
          Math.min(ha, hb) / Math.max(ha, hb) > 0.35) {
        last.words.push(...ln.words);
        last.bbox = {
          x0: Math.min(last.bbox.x0, ln.bbox.x0),
          y0: Math.min(last.bbox.y0, ln.bbox.y0),
          x1: Math.max(last.bbox.x1, ln.bbox.x1),
          y1: Math.max(last.bbox.y1, ln.bbox.y1),
        };
        continue;
      }
    }
    rows.push({
      bbox: { ...ln.bbox },
      words: ln.words.map((w) => ({ text: w.text, conf: w.conf ?? w.confidence,
                                    bbox: w.bbox })),
    });
  }
  for (const r of rows) r.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
  return rows;
}

/** Satırdaki dayanım adaylarını (tekil + küçük boşlukla bitişik ikili) verir. */
function strengthCandidates(row) {
  const out = [];
  const ws = row.words;
  for (let i = 0; i < ws.length; i++) {
    const v = normStrengthToken(ws[i].text);
    if (v !== null) out.push({ value: v, cx: cx(ws[i]) });
    const nxt = ws[i + 1];
    if (nxt && nxt.bbox.x0 - ws[i].bbox.x1 <= 25) {
      const vj = normStrengthToken(ws[i].text + nxt.text);
      if (vj !== null && v === null) {
        out.push({
          value: vj,
          cx: (ws[i].bbox.x0 + nxt.bbox.x1) / 2,
        });
      }
    }
  }
  return out;
}

/** Seçilen sütun aralığındaki kelimeleri birleştirip değer okur. */
function valueInColumn(row, x0, x1) {
  const inCol = row.words.filter((w) => cx(w) >= x0 && cx(w) <= x1);
  if (!inCol.length) return null;
  return normStrengthToken(inCol.map((w) => w.text).join(""));
}

/** "28 Günlük" başlık adayları: [x0, x1] aralıkları. */
function headerCandidates(rows) {
  const out = [];
  for (const row of rows) {
    const joined = norm(row.words.map((w) => w.text).join(" "));
    if (!joined.includes("GUN")) continue;
    for (let i = 0; i < row.words.length; i++) {
      if (fixDigits(row.words[i].text.trim()) !== "28") continue;
      let x1 = row.words[i].bbox.x1;
      const nxt = row.words[i + 1];
      if (nxt && nxt.bbox.x0 - x1 <= 80) x1 = nxt.bbox.x1;
      out.push({ x0: row.words[i].bbox.x0 - 20, x1: x1 + 20 });
    }
  }
  return out;
}

/**
 * Bir sayfanın OCR satırlarından numune satırlarını çıkarır.
 * Dönen: [{group, kalip|null, value}] (y sırasında).
 */
export function parseSpecimenRowsFromOcr(pageLines, notes) {
  const rows = rowsFromOcrLines(pageLines);
  if (!rows.length) return [];
  const pageW = Math.max(...rows.map((r) => r.bbox.x1));

  // Kalıp deseni taşıyan satırlar
  const kalipRows = [];
  for (const row of rows) {
    let hit = null;
    for (let i = 0; i < row.words.length && !hit; i++) {
      hit = kalipFromToken(row.words[i].text);
      if (hit) hit.word = row.words[i];
      if (!hit && row.words[i + 1] &&
          row.words[i + 1].bbox.x0 - row.words[i].bbox.x1 <= 30) {
        hit = kalipFromToken(row.words[i].text + row.words[i + 1].text);
        if (hit) hit.word = row.words[i];
      }
    }
    if (hit) kalipRows.push({ row, ...hit });
  }
  if (!kalipRows.length) return [];

  // --- Değer sütununu belirle ---
  // 1) Başlık adayları arasından, kalıp satırlarında en çok geçerli değer
  //    barındıranı seç ("28 Günlük Numune" tekil sütunu, 1/3 satırda dolu
  //    olan "28 Günlük Deney Sonuçları" ortalama sütununu böyle yener).
  let col = null, bestCov = 0;
  for (const h of headerCandidates(rows)) {
    const cov = kalipRows.filter(
      (k) => valueInColumn(k.row, h.x0, h.x1) !== null).length;
    if (cov > bestCov) { bestCov = cov; col = h; }
  }
  if (!col || bestCov < Math.max(2, kalipRows.length * 0.4)) {
    // 2) Başlık okunamadıysa sütun konsensüsü: aday x-merkezlerini kümele,
    //    kapsaması yüksek kümelerden EN SAĞDAKİNİ al (28 günlük sütunu
    //    raporlarda 7 günlük sütunun sağındadır).
    const tol = Math.max(30, pageW * 0.015);
    const clusters = [];
    for (const k of kalipRows) {
      for (const c of strengthCandidates(k.row)) {
        const cl = clusters.find((q) => Math.abs(q.cx - c.cx) <= tol);
        if (cl) {
          cl.rows.add(k.row);
          cl.cx = (cl.cx * cl.n + c.cx) / (cl.n + 1);
          cl.n++;
        } else {
          clusters.push({ cx: c.cx, n: 1, rows: new Set([k.row]) });
        }
      }
    }
    if (!clusters.length) return [];
    const maxCov = Math.max(...clusters.map((c) => c.rows.size));
    if (maxCov < 2) return [];
    const good = clusters.filter((c) => c.rows.size >= 0.6 * maxCov);
    const pick = good.reduce((a, b) => (b.cx > a.cx ? b : a));
    col = { x0: pick.cx - tol * 1.6, x1: pick.cx + tol * 1.6 };
  }

  // --- Kalıp satırlarından değerleri oku ---
  let valued = [];
  for (const k of kalipRows) {
    const v = valueInColumn(k.row, col.x0, col.x1);
    if (v !== null) valued.push({ k, value: v, y: cy(k.row.bbox) });
  }
  if (!valued.length) return [];

  // Numune tablosu, düzenli aralıklı yoğun bir satır bloğudur. Sayfa altındaki
  // kriter/sınıf tablolarından tesadüfen değer üreten tekil satırlar (örn.
  // "2-4" satırındaki beton sınıfı "55"i) bu bloktan uzakta kalır: satırlar
  // y-boşluğuna göre kümelenir, 3+ satırlık kümeler dışındakiler atılır.
  valued.sort((a, b) => a.y - b.y);
  if (valued.length > 1) {
    const gaps = valued.slice(1).map((v, i) => v.y - valued[i].y)
      .filter((g) => g > 0).sort((a, b) => a - b);
    const medGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 60;
    const cutoff = Math.max(200, medGap * 3.5);
    const clusters = [[valued[0]]];
    for (let i = 1; i < valued.length; i++) {
      if (valued[i].y - valued[i - 1].y > cutoff) clusters.push([]);
      clusters[clusters.length - 1].push(valued[i]);
    }
    const kept = clusters.filter((c) => c.length >= 3);
    if (kept.length) valued = kept.flat();
  }

  const out = valued.map(({ k, value, y }) => ({
    group: k.group, kalip: `${k.group}-${k.spec}`, value, y,
  }));
  const valuedSet = new Set(valued.map((v) => v.k));
  const ys = valued.map((v) => v.y);
  const rowGap = ys.length > 1
    ? Math.max(40, (ys[ys.length - 1] - ys[0]) / (ys.length - 1) * 1.6)
    : 80;
  const spanY0 = ys[0] - rowGap, spanY1 = ys[ys.length - 1] + rowGap;

  // Tablo aralığında kalıbı bulunup değeri okunamayanlar not edilir;
  // sayfa altındaki kriter tablolarından gelen sahte kalıplar sessizce elenir.
  for (const k of kalipRows) {
    if (valuedSet.has(k)) continue;
    const y = cy(k.row.bbox);
    if (y >= spanY0 && y <= spanY1) {
      notes.push(`Kalıp ${k.group}-${k.spec}: 28 günlük dayanım değeri ` +
                 "okunamadı — belgeden bakarak elle girin.");
    }
  }

  // --- Kalıp hücresi bozuk okunan satırları mikser sütunundan kurtar ---
  // Mikser (grup) sütununun konumu, kalıp satırlarında grup numarasıyla
  // birebir aynı metni taşıyan kelimelerin medyan x-merkezidir.
  const mxs = [];
  for (const { k } of valued) {
    for (const w of k.row.words) {
      if (w === k.word) continue;
      if (fixDigits(w.text.trim()) === k.group && cx(w) < cx(k.word)) {
        mxs.push(cx(w));
      }
    }
  }
  if (mxs.length >= 3) {
    mxs.sort((a, b) => a - b);
    const mcx = mxs[Math.floor(mxs.length / 2)];
    const tol = Math.max(30, pageW * 0.015);
    const kalipRowSet = new Set(kalipRows.map((k) => k.row));
    for (const row of rows) {
      if (kalipRowSet.has(row)) continue;
      const y = cy(row.bbox);
      if (y < spanY0 || y > spanY1) continue;
      const v = valueInColumn(row, col.x0, col.x1);
      if (v === null) continue;
      const gw = row.words.find((w) => Math.abs(cx(w) - mcx) <= tol &&
                                       /^\d{1,2}$/.test(fixDigits(w.text.trim())));
      if (!gw) continue;
      out.push({ group: fixDigits(gw.text.trim()), kalip: null, value: v, y });
      notes.push(`Grup ${fixDigits(gw.text.trim())}: kalıp numarası bozuk ` +
                 `okunan bir satırdan ${v.toFixed(1).replace(".", ",")} MPa ` +
                 "değeri sütun konumuna göre alındı — belgeyle karşılaştırın.");
    }
  }

  out.sort((a, b) => a.y - b.y);
  return out.map(({ group, kalip, value }) => ({ group, kalip, value }));
}

/* ------------------------------------------------------------------ */
/* Ana çözümleme                                                       */
/* ------------------------------------------------------------------ */
/**
 * pages: her sayfa için satır dizisi (string[][]).
 * opts.ocr: satırlar OCR'dan geldiyse true (toleranslar gevşetilir).
 * opts.ocrPages: sayfa başına tesseract satırları ({words, bbox}) — verilirse
 *   numune tablosu kelime konumlarından (bbox) geri çatılır; kelime yaklaşımı
 *   sonuç veremezse satır-temelli çözümleyiciye düşülür.
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
  let rawRows = [];
  if (opts.ocrPages) {
    for (const pageLines of opts.ocrPages) {
      rawRows.push(...parseSpecimenRowsFromOcr(pageLines, notes));
    }
  }
  if (!rawRows.length) rawRows = parseSpecimenRows(allLines, notes, ocr);
  const groups = new Map();
  const seenKalip = new Set();
  for (const r of rawRows) {
    if (r.kalip !== null && r.kalip !== undefined) {
      if (seenKalip.has(r.kalip)) continue;
      seenKalip.add(r.kalip);
    }
    if (!groups.has(r.group)) {
      groups.set(r.group, { group_no: r.group, values: [] });
    }
    groups.get(r.group).values.push(r.value);
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
