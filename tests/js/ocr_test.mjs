/*
 * OCR hattının uçtan uca doğrulanması (Node + tesseract.js).
 *   node tests/js/ocr_test.mjs
 *
 * assets/scan_test_p*.png fikstürleri, örnek raporun 200 DPI taranmış hâlini
 * temsil eder (assets/ kişisel veri içerdiğinden depoya dahil değildir;
 * fikstür yoksa test atlanır). OCR doğası gereği %100 isabet beklenmez —
 * eşikler toleranslıdır: grupların çoğunluğu ve değerlerin en az 2/3'ü
 * doğru okunmalıdır.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

const P1 = join(root, "assets", "scan_test_p1.png");
const P2 = join(root, "assets", "scan_test_p2.png");
if (!existsSync(P1)) {
  console.log("(bilgi) tarama fikstürü yok — OCR testi atlandı.");
  process.exit(0);
}

const { linesFromOcrData } = await import(
  new URL("file://" + join(root, "docs", "ocr.js").replace(/\\/g, "/")));
const { parseReportFromPages } = await import(
  new URL("file://" + join(root, "docs", "pdfread.js").replace(/\\/g, "/")));
const { createWorker } = await import("tesseract.js");

const EXPECTED = {
  "1": [44.8, 40.0, 45.8], "2": [48.0, 49.3, 47.9], "3": [45.7, 39.5, 42.1],
  "4": [45.4, 46.5, 47.4], "5": [45.6, 46.4, 43.0], "6": [43.5, 47.2, 46.6],
  "7": [46.9, 38.3, 47.5], "8": [47.2, 50.3, 47.0], "9": [47.9, 43.8, 52.2],
  "10": [48.5, 48.1, 43.9],
};

console.log("OCR motoru yükleniyor (Türkçe dil verisi: docs/vendor/tesseract/lang)…");
const worker = await createWorker("tur", 1, {
  langPath: join(root, "docs", "vendor", "tesseract", "lang"),
  cachePath: tmpdir(),
  gzip: true,
});
await worker.setParameters({
  tessedit_pageseg_mode: "3", // tesseract.js varsayılanı PSM 6 tablolarda başarısız
  preserve_interword_spaces: "1",
});

const pages = [];
for (const p of [P1, P2].filter(existsSync)) {
  console.log("Sayfa okunuyor:", p);
  const { data } = await worker.recognize(p);
  pages.push(linesFromOcrData(data));
}
await worker.terminate();

const rep = parseReportFromPages(pages, { ocr: true });
const got = Object.fromEntries(rep.gruplar.map((g) => [g.group_no, g.values]));

let groupsFound = 0, valuesMatched = 0, totalExpected = 0;
for (const [gno, vals] of Object.entries(EXPECTED)) {
  totalExpected += vals.length;
  if (!(gno in got)) continue;
  groupsFound++;
  for (const v of vals) {
    if (got[gno].some((x) => Math.abs(x - v) < 0.051)) valuesMatched++;
  }
}

console.log(`\nBulunan grup: ${groupsFound}/10; eşleşen değer: ` +
            `${valuesMatched}/${totalExpected}`);
console.log("Okunan gruplar:", JSON.stringify(got));
console.log("rapor_no:", rep.rapor_no, "| beton_sinifi:", rep.beton_sinifi,
            "| esas:", rep.sonuc_esasi);

let failed = 0;
if (groupsFound < 7) {
  failed++;
  console.error(`✗ OCR en az 7 grup bulmalıydı (bulunan: ${groupsFound})`);
}
if (valuesMatched < Math.ceil(totalExpected * 2 / 3)) {
  failed++;
  console.error(`✗ OCR değerlerin en az 2/3'ünü doğru okumalıydı ` +
                `(${valuesMatched}/${totalExpected})`);
}
if (!rep.okuma_notlari.some((n) => n.includes("OCR"))) {
  failed++;
  console.error("✗ OCR uyarı notu eksik");
}
console.log(failed ? "\nBAŞARISIZ" : "\nOCR testi geçti.");
process.exit(failed ? 1 : 0);
