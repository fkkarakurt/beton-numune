/*
 * JS motoru ve PDF okuyucusunun Node üzerinde doğrulanması.
 *   node tests/js/run_tests.mjs
 *
 * 1) docs/engine.js, Python referans motorundan üretilen tests/vectors.json
 *    ile çapraz doğrulanır (sayısal birebir eşleşme).
 * 2) docs/pdfread.js, örnek PDF üzerinde pdf.js ile uçtan uca doğrulanır.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

const { evaluate } = await import(
  new URL("file://" + join(root, "docs", "engine.js").replace(/\\/g, "/")));
const { parseReportFromPages, linesFromTextContent } = await import(
  new URL("file://" + join(root, "docs", "pdfread.js").replace(/\\/g, "/")));
const { buildReportHTML, standaloneReportHTML, REFERENCES } = await import(
  new URL("file://" + join(root, "docs", "report.js").replace(/\\/g, "/")));

let passed = 0, failed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n  ${e.message}`);
  }
}
const approx = (a, b, eps = 0.051) => {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= eps;
};

/* ---------------- 1) Motor çapraz doğrulama ---------------- */
const vectors = JSON.parse(
  readFileSync(join(root, "tests", "vectors.json"), "utf-8"));

for (const v of vectors) {
  check(`engine: ${v.name}`, () => {
    const res = evaluate({
      concreteClass: v.input.concrete_class,
      basis: v.input.basis,
      groups: v.input.groups,
      volumeM3: v.input.volume_m3 ?? null,
      samplingDate: v.input.sampling_date ?? null,
      testDate: v.input.test_date ?? null,
    });
    const e = v.expected;
    assert.equal(res.verdict, e.verdict, "verdict");
    assert.equal(res.fck, e.fck, "fck");
    assert.ok(approx(res.fcm, e.fcm), `fcm ${res.fcm} != ${e.fcm}`);
    assert.ok(approx(res.fci_min, e.fci_min), `fci_min ${res.fci_min}`);
    assert.equal(res.n_valid, e.n_valid, "n_valid");
    assert.equal(res.n_invalid, e.n_invalid, "n_invalid");
    assert.equal(res.age_days, e.age_days, "age_days");
    assert.equal(res.warnings.length, e.n_warnings,
                 `uyarı sayısı ${res.warnings.length} != ${e.n_warnings}`);
    assert.equal((res.notes || []).length, e.n_notes ?? 0,
                 `not sayısı ${(res.notes || []).length} != ${e.n_notes ?? 0}`);
    for (const [crit, exp] of [["criterion1", e.criterion1],
                               ["criterion2", e.criterion2]]) {
      if (exp === null) { assert.equal(res[crit], null, crit); continue; }
      assert.equal(res[crit].applicable, exp.applicable, crit + ".applicable");
      assert.equal(res[crit].passed, exp.passed, crit + ".passed");
      assert.ok(approx(res[crit].threshold, exp.threshold), crit + ".threshold");
    }
    const en206 = res.en206_initial === null ? null : res.en206_initial.passed;
    assert.equal(en206, e.en206_passed, "en206");
    assert.equal(res.groups.length, e.groups.length, "grup sayısı");
    e.groups.forEach((eg, i) => {
      const g = res.groups[i];
      assert.equal(g.group_no, eg.group_no, "group_no");
      assert.equal(g.valid, eg.valid, `grup ${eg.group_no} valid`);
      for (const f of ["mean_final", "discarded_value", "mean_initial",
                       "range_initial", "limit_initial"]) {
        assert.ok(approx(g[f], eg[f]),
                  `grup ${eg.group_no} ${f}: ${g[f]} != ${eg[f]}`);
      }
    });
  });
}

/* ---------------- 2) PDF okuma uçtan uca ---------------- */
const EXPECTED_GROUPS = {
  "1": [44.8, 40.0, 45.8], "2": [48.0, 49.3, 47.9], "3": [45.7, 39.5, 42.1],
  "4": [45.4, 46.5, 47.4], "5": [45.6, 46.4, 43.0], "6": [43.5, 47.2, 46.6],
  "7": [46.9, 38.3, 47.5], "8": [47.2, 50.3, 47.0], "9": [47.9, 43.8, 52.2],
  "10": [48.5, 48.1, 43.9],
};

const samplePdf = join(root, "assets", "ornek_beton_raporu.pdf");
if (!existsSync(samplePdf)) {
  // assets/ kişisel veri içerdiğinden depoya dahil edilmez.
  console.log("(bilgi) örnek PDF bulunamadı — PDF okuma testleri atlandı.");
} else try {
  const pdfjs = await import(
    new URL("file://" + join(root, "docs", "vendor", "pdf.min.js")
      .replace(/\\/g, "/")));
  pdfjs.GlobalWorkerOptions.workerSrc =
    "file://" + join(root, "docs", "vendor", "pdf.worker.min.js")
      .replace(/\\/g, "/");
  const data = new Uint8Array(readFileSync(samplePdf));
  const doc = await pdfjs.getDocument({ data, useWorkerFetch: false,
                                        isEvalSupported: false }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    pages.push(linesFromTextContent(tc.items));
  }
  const rep = parseReportFromPages(pages);

  check("pdf: grup değerleri", () => {
    const got = Object.fromEntries(rep.gruplar.map((g) => [g.group_no, g.values]));
    assert.deepEqual(Object.keys(got).sort(), Object.keys(EXPECTED_GROUPS).sort());
    for (const [k, vals] of Object.entries(EXPECTED_GROUPS)) {
      assert.deepEqual(got[k], vals, `grup ${k}: ${JSON.stringify(got[k])}`);
    }
  });
  check("pdf: başlık alanları", () => {
    assert.equal(rep.rapor_no, "B601-28-23");
    assert.equal(rep.yibf_no, "1487616");
    assert.equal(rep.beton_sinifi, "C35/45");
    assert.equal(rep.beton_miktari_m3, 600);
    assert.equal(rep.alinan_numune_adedi, 40);
    assert.ok(rep.uretici_firma.includes("NUH"), "üretici: " + rep.uretici_firma);
    assert.ok(rep.deney_isteyen.includes("AHS"), "isteyen: " + rep.deney_isteyen);
  });
  check("pdf: tarihler ve esas", () => {
    assert.equal(rep.alinis_tarihi, "2023-04-16");
    assert.equal(rep.deney_tarihi, "2023-05-14");
    assert.equal(rep.sonuc_esasi, "silindir");
  });
} catch (e) {
  failed++;
  console.error("✗ pdf.js yükleme/okuma hatası:", e.message);
}

/* ---------------- 3) Akademik rapor üretimi (duman testi) ---------------- */
check("report: türetimler ve referanslar", () => {
  const req = {
    concrete_class: "C35/45", basis: "silindir", volume_m3: 600,
    groups: Object.entries(EXPECTED_GROUPS).map(([k, v]) =>
      ({ group_no: k, values: v })),
    project: { rapor_no: "B601-28-23", yapi_elemani: "TEMEL",
               alinis_tarihi: "2023-04-16", deney_tarihi: "2023-05-14",
               degerlendiren: "Test Mühendisi" },
  };
  const res = evaluate({
    concreteClass: req.concrete_class, basis: req.basis, groups: req.groups,
    volumeM3: req.volume_m3, samplingDate: "2023-04-16", testDate: "2023-05-14",
  });
  const html = buildReportHTML(req, res, new Date("2026-07-21T10:00:00"));

  // Grup 7 türetimi: %15 aşımı, 38,3'ün atılması ve 47,2 sonucu gösterilmeli
  assert.ok(html.includes("9,2"), "grup 7 fark (9,2) raporda yok");
  assert.ok(html.includes("(38,3 MPa) değerlendirme dışı"),
            "atılan değerin gerekçesi raporda yok");
  assert.ok(html.includes("47,2 MPa</strong> olarak alınır"),
            "yinelenen kontrol sonucu raporda yok");
  // fcm türetimi ve kriter denetimi sayısal olarak gösterilmeli
  assert.ok(html.includes(`/ ${res.n_valid} =`), "fcm hesabı raporda yok");
  assert.ok(html.includes("SAĞLANIR"), "kriter sonucu raporda yok");
  assert.ok(html.includes("UYGUN"), "sonuç raporda yok");
  // Kaynakça tam olmalı ve metin içi atıflar bulunmalı
  for (const ref of REFERENCES) {
    assert.ok(html.includes(ref.slice(0, 30)), "kaynak eksik: " + ref.slice(0, 40));
  }
  assert.ok(/\[1(,| |\])/.test(html) && html.includes("[3]"),
            "metin içi atıf işaretleri yok");
  // Bağımsız HTML dosyası üretimi
  const standalone = standaloneReportHTML(req, res, "/* css */");
  assert.ok(standalone.startsWith("<!DOCTYPE html>"));
  assert.ok(standalone.includes("report-paper"));
});

check("report: tek mikser 6 numune bölünmesi (TS 13515 Ek B1 (3))", () => {
  const req = {
    concrete_class: "C30/37", basis: "kup",
    groups: [{ group_no: "1", values: [45.2, 43.8, 44.6, 46.1, 44.9, 43.5] }],
    project: {},
  };
  const res = evaluate({ concreteClass: "C30/37", basis: "kup",
                         groups: req.groups });
  assert.equal(res.groups.length, 2, "6 numune 2 takıma bölünmeli");
  assert.equal(res.groups[0].group_no, "1-A");
  assert.equal(res.groups[1].group_no, "1-B");
  assert.equal(res.n_valid, 2);
  assert.equal(res.criterion1.threshold, 38, "n=2 -> fck+1");
  assert.equal(res.notes.length, 1, "bölünme açıklaması olmalı");
  const html = buildReportHTML(req, res);
  assert.ok(html.includes("1-A") && html.includes("1-B"),
            "takım etiketleri raporda yok");
  assert.ok(html.includes("2022/07"), "Genelge 2022/07 atfı raporda yok");
  assert.ok(html.includes("Ek B1 (3)"), "Ek B1 (3) açıklaması raporda yok");
});

check("report: geçersiz grup anlatımı", () => {
  const req = {
    concrete_class: "C30/37", basis: "silindir",
    groups: [{ group_no: "1", values: [50.0, 30.0, 20.0] }], project: {},
  };
  const res = evaluate({ concreteClass: "C30/37", basis: "silindir",
                         groups: req.groups });
  const html = buildReportHTML(req, res);
  assert.ok(html.includes("yine sağlanmaz"), "ikinci kontrol anlatımı yok");
  assert.ok(html.includes("geçersiz"), "geçersizlik anlatımı yok");
  assert.ok(html.includes("DEĞERLENDİRİLEMEDİ"), "sonuç yok");
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
process.exit(failed ? 1 : 0);
