/* Beton Numune Değerlendirme — arayüz mantığı (tamamen istemci tarafı). */
"use strict";

import { CONCRETE_CLASSES, evaluate } from "./engine.js";
import { getOcrWorker, imageFileToCanvas, ocrCanvas,
         renderPdfPageToCanvas } from "./ocr.js";
import { linesFromTextContent, parseReportFromPages } from "./pdfread.js";
import { buildReportHTML, standaloneReportHTML } from "./report.js";

const $ = (id) => document.getElementById(id);
const STORE_KEY = "bn_records_v1";

const PROJECT_FIELDS = [
  "rapor_no", "lab_adi", "lab_izin_belge_no", "yibf_no", "deney_isteyen",
  "muteahhit", "yapi_sahibi", "uretici_firma", "santiye_adresi",
  "pafta_ada_parsel", "yapi_elemani", "kat_kot_blok", "numune_boyut_sekil",
  "alinis_tarihi", "deney_tarihi", "degerlendiren",
];

let selectedFiles = [];
let lastRequest = null;
let lastResult = null;
let pdfjsPromise = null;
let reportCssPromise = null;

/* ---------------- başlangıç ---------------- */
function init() {
  const sel = $("f-concrete_class");
  for (const c of Object.keys(CONCRETE_CLASSES)) {
    const o = document.createElement("option");
    o.value = c; o.textContent = c;
    sel.appendChild(o);
  }
  sel.value = "C30/37";
  for (let i = 0; i < 3; i++) addGroupRow();
}

/* ---------------- dosya seçimi ---------------- */
const dz = $("dropzone");
dz.addEventListener("click", () => $("file-input").click());
dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
dz.addEventListener("drop", (e) => {
  e.preventDefault(); dz.classList.remove("drag");
  addFiles(e.dataTransfer.files);
});
$("file-input").addEventListener("change", (e) => addFiles(e.target.files));

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;

function addFiles(list) {
  for (const f of list) {
    if (!f.name.toLowerCase().endsWith(".pdf") && !IMAGE_EXT.test(f.name)) {
      alert(`${f.name}: desteklenmeyen dosya türü. PDF, JPG, PNG veya WEBP yükleyin.`);
      continue;
    }
    selectedFiles.push(f);
  }
  renderFileList();
}
function renderFileList() {
  const ul = $("file-list");
  ul.innerHTML = "";
  selectedFiles.forEach((f, i) => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = `${f.name}  (${(f.size / 1024 / 1024).toFixed(2)} MB)`;
    const rm = document.createElement("button");
    rm.textContent = "✕";
    rm.title = "Kaldır";
    rm.onclick = () => { selectedFiles.splice(i, 1); renderFileList(); };
    li.append(name, rm);
    ul.appendChild(li);
  });
  $("btn-extract").disabled = selectedFiles.length === 0;
}

/* ---------------- PDF okuma (pdf.js, yerel) ---------------- */
function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("./vendor/pdf.min.js").then((m) => {
      m.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.js";
      return m;
    });
  }
  return pdfjsPromise;
}

async function readPdfPages(file) {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    pages.push(linesFromTextContent(tc.items));
  }
  return pages;
}

/* Tek PDF: önce metin katmanı, bulunamazsa OCR (tarama/CamScanner). */
async function extractFromPdf(file, setStatus) {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;

  const textPages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    textPages.push(linesFromTextContent(tc.items));
  }
  let textRep = null;
  try { textRep = parseReportFromPages(textPages); } catch { textRep = null; }
  if (textRep && textRep.gruplar.length) return textRep;

  // Metin katmanı yok ya da yetersiz (CamScanner vb. görüntü tabanlı PDF)
  setStatus(`${file.name}: metin katmanı bulunamadı — OCR ile okunuyor…`);
  const worker = await getOcrWorker(setStatus);
  const ocrPages = [], ocrRows = [];
  for (let p = 1; p <= doc.numPages; p++) {
    setStatus(`${file.name}: sayfa ${p}/${doc.numPages} OCR ile okunuyor… ` +
              "(sayfa başına 5-20 sn)");
    const page = await doc.getPage(p);
    const res = await ocrCanvas(worker, await renderPdfPageToCanvas(page));
    ocrPages.push(res.lines);
    ocrRows.push(res.rows);
  }
  const ocrRep = parseReportFromPages(ocrPages, { ocr: true, ocrPages: ocrRows });
  // Metin katmanı başlık verebilmişse (ör. yalnız filigran değilse) boş
  // alanları oradan tamamla
  if (textRep) {
    for (const k of Object.keys(ocrRep)) {
      if (k !== "gruplar" && k !== "okuma_notlari" &&
          (ocrRep[k] === null || ocrRep[k] === undefined) &&
          textRep[k] !== null && textRep[k] !== undefined) {
        ocrRep[k] = textRep[k];
      }
    }
  }
  return ocrRep;
}

/* Fotoğraflar: hepsi tek raporun sayfaları kabul edilir, birlikte OCR'lanır. */
async function extractFromImages(files, setStatus) {
  const worker = await getOcrWorker(setStatus);
  const pages = [], rows = [];
  for (let i = 0; i < files.length; i++) {
    setStatus(`Fotoğraf ${i + 1}/${files.length} OCR ile okunuyor… ` +
              "(fotoğraf başına 5-20 sn)");
    const res = await ocrCanvas(worker, await imageFileToCanvas(files[i]));
    pages.push(res.lines);
    rows.push(res.rows);
  }
  return parseReportFromPages(pages, { ocr: true, ocrPages: rows });
}

function mergeReports(reps, notes) {
  let merged = null;
  for (const rep of reps) {
    if (!merged) { merged = rep; continue; }
    const existing = new Set(merged.gruplar.map((g) => g.group_no));
    for (const g of rep.gruplar) {
      if (!existing.has(g.group_no)) merged.gruplar.push(g);
    }
    for (const k of Object.keys(rep)) {
      if (k !== "gruplar" && k !== "okuma_notlari" &&
          (merged[k] === null || merged[k] === undefined) &&
          rep[k] !== null) merged[k] = rep[k];
    }
    notes.push(...rep.okuma_notlari);
  }
  return merged;
}

$("btn-extract").addEventListener("click", async () => {
  const btn = $("btn-extract"), st = $("extract-status");
  btn.disabled = true;
  const setStatus = (t) => { st.textContent = t; };
  setStatus("Belge okunuyor…");
  $("extract-notes").classList.add("hidden");
  try {
    const pdfs = selectedFiles.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    const images = selectedFiles.filter((f) => IMAGE_EXT.test(f.name));
    const reps = [];
    const notes = [];
    for (const f of pdfs) {
      try {
        reps.push(await extractFromPdf(f, setStatus));
      } catch (e) {
        notes.push(`${f.name}: ${e.message}`);
      }
    }
    if (images.length) {
      try {
        reps.push(await extractFromImages(images, setStatus));
      } catch (e) {
        notes.push("Fotoğraflar: " + e.message);
      }
    }
    const merged = mergeReports(reps, notes);
    if (!merged) throw new Error(notes.join(" | ") || "Belge okunamadı.");
    merged.okuma_notlari = [...new Set([...merged.okuma_notlari, ...notes])];
    fillFromExtraction(merged);
    setStatus("✓ Veriler forma aktarıldı. Lütfen belgeyle karşılaştırıp doğrulayın!");
  } catch (e) {
    setStatus("✗ " + e.message);
  } finally {
    btn.disabled = selectedFiles.length === 0;
  }
});

function fillFromExtraction(d) {
  for (const k of PROJECT_FIELDS) {
    if (d[k] !== null && d[k] !== undefined && $("f-" + k)) $("f-" + k).value = d[k];
  }
  if (d.beton_sinifi) {
    const val = String(d.beton_sinifi).toUpperCase().replace(/\s+/g, "");
    if (val in CONCRETE_CLASSES) $("f-concrete_class").value = val;
  }
  if (d.beton_miktari_m3 !== null && d.beton_miktari_m3 !== undefined) {
    $("f-volume").value = d.beton_miktari_m3;
  }
  if (d.sonuc_esasi === "silindir" || d.sonuc_esasi === "kup") {
    $("f-basis").value = d.sonuc_esasi;
  }

  $("groups-body").innerHTML = "";
  const groups = d.gruplar || [];
  if (!groups.length) addGroupRow();
  for (const g of groups) {
    addGroupRows({ group_no: g.group_no, values: g.values || [] });
  }

  const notes = [...(d.okuma_notlari || [])];
  if (d.alinan_numune_adedi !== null && d.alinan_numune_adedi !== undefined) {
    const total = groups.reduce((s, g) => s + (g.values ? g.values.length : 0), 0);
    if (total !== d.alinan_numune_adedi) {
      notes.push(`Raporda "alınan numune adedi" ${d.alinan_numune_adedi} yazıyor; ` +
        `belgeden ${total} adet 28 günlük tekil sonuç okundu. Fark, yedek/7 ` +
        `günlük numunelerden veya eksik sayfadan kaynaklanabilir — kontrol edin.`);
    }
  }
  const ul = $("extract-notes");
  ul.innerHTML = "";
  if (notes.length) {
    for (const n of notes) {
      const li = document.createElement("li");
      li.textContent = n;
      ul.appendChild(li);
    }
    ul.classList.remove("hidden");
  }
}

/* ---------------- grup satırları ---------------- */
function addGroupRow(data) {
  const tb = $("groups-body");
  const tr = document.createElement("tr");
  const no = data?.group_no ?? String(tb.children.length + 1);
  const v = data?.values || [];
  tr.innerHTML = `
    <td><input class="g-no" value="${escapeHtml(String(no))}"></td>
    <td><input class="g-v1" type="number" step="0.1" value="${v[0] ?? ""}"></td>
    <td><input class="g-v2" type="number" step="0.1" value="${v[1] ?? ""}"></td>
    <td><input class="g-v3" type="number" step="0.1" value="${v[2] ?? ""}"></td>
    <td><button class="btn small" title="Satırı sil">✕</button></td>`;
  tr.querySelector("button").onclick = () => tr.remove();
  tb.appendChild(tr);
}

/* Bir grupta 3'ten fazla tekil sonuç varsa (tek mikserden 6 numune — TS 13515
 * Ek B1 (3)) aynı grup numarasıyla 3'erli satırlara bölerek ekler; readGroups
 * aynı numaralı satırları tek grupta birleştirir, takım ayrımını motor yapar. */
function addGroupRows(data) {
  const vals = data?.values || [];
  if (vals.length <= 3) { addGroupRow(data); return; }
  for (let i = 0; i < vals.length; i += 3) {
    addGroupRow({ group_no: data.group_no, values: vals.slice(i, i + 3) });
  }
}
$("btn-add-group").addEventListener("click", () => addGroupRow());
$("btn-clear-groups").addEventListener("click", () => {
  $("groups-body").innerHTML = "";
  addGroupRow();
});

function readGroups() {
  // Aynı grup/mikser numarasını taşıyan satırlar tek grupta birleştirilir:
  // tek mikserden alınan 6 numune iki satıra yazılır, motor TS 13515
  // Ek B1 (3) uyarınca takımlara ayırır.
  const groups = [];
  const byNo = new Map();
  for (const tr of $("groups-body").children) {
    const vals = [".g-v1", ".g-v2", ".g-v3"]
      .map((c) => tr.querySelector(c).value.trim())
      .filter((s) => s !== "")
      .map(Number);
    const no = tr.querySelector(".g-no").value.trim();
    if (!vals.length && !no) continue;
    const key = no || String(groups.length + 1);
    if (byNo.has(key)) {
      byNo.get(key).values.push(...vals);
    } else {
      const g = { group_no: key, values: vals };
      byNo.set(key, g);
      groups.push(g);
    }
  }
  return groups;
}

/* ---------------- değerlendirme ---------------- */
$("btn-evaluate").addEventListener("click", () => {
  const groups = readGroups();
  if (!groups.length || groups.every((g) => g.values.length === 0)) {
    alert("En az bir grupta numune sonucu girilmelidir.");
    return;
  }
  const project = {};
  for (const f of PROJECT_FIELDS) project[f] = $("f-" + f).value.trim() || null;
  const req = {
    concrete_class: $("f-concrete_class").value,
    basis: $("f-basis").value,
    volume_m3: $("f-volume").value ? Number($("f-volume").value) : null,
    groups, project,
  };
  let res;
  try {
    res = evaluate({
      concreteClass: req.concrete_class, basis: req.basis, groups: req.groups,
      volumeM3: req.volume_m3, samplingDate: project.alinis_tarihi,
      testDate: project.deney_tarihi,
    });
  } catch (e) {
    alert("Değerlendirme hatası: " + e.message);
    return;
  }
  lastRequest = req;
  lastResult = res;
  showResult(req, res);
  $("save-status").textContent = "";
});

function showResult(req, res) {
  const strip = $("result-strip");
  strip.innerHTML = `
    <div>
      <div class="v">SONUÇ: ${escapeHtml(res.verdict)}</div>
      <div class="d">${escapeHtml(req.concrete_class)} — esas:
        ${res.basis === "silindir" ? "silindir (150×300 eşdeğeri)" : "küp (150 mm eşdeğeri)"};
        fck = ${res.fck} MPa; n = ${res.n_valid}; fcm =
        ${res.fcm !== null ? res.fcm.toFixed(1).replace(".", ",") : "—"} MPa</div>
    </div>
    <div class="d">TS 500 m.3.4 / TS EN 206 / TS 13515 Ek B1</div>`;
  $("report-paper").innerHTML = buildReportHTML(req, res);
  $("results").classList.remove("hidden");
  $("report-holder").classList.remove("hidden");
  $("results").scrollIntoView({ behavior: "smooth" });
}

/* ---------------- indirme / yazdırma ---------------- */
$("btn-print").addEventListener("click", () => window.print());

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function baseName() {
  const rn = lastRequest?.project?.rapor_no;
  return "beton-degerlendirme" + (rn ? "-" + rn.replace(/[^\w-]+/g, "_") : "");
}

function getReportCss() {
  if (!reportCssPromise) {
    reportCssPromise = fetch("./report.css").then((r) => r.text());
  }
  return reportCssPromise;
}

$("btn-dl-html").addEventListener("click", async () => {
  if (!lastRequest) return;
  const css = await getReportCss();
  download(baseName() + ".html",
           standaloneReportHTML(lastRequest, lastResult, css),
           "text/html;charset=utf-8");
});

$("btn-dl-json").addEventListener("click", () => {
  if (!lastRequest) return;
  download(baseName() + ".json",
           JSON.stringify({ request: lastRequest, result: lastResult }, null, 1),
           "application/json;charset=utf-8");
});

/* ---------------- kayıtlar (localStorage) ---------------- */
function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
  catch { return []; }
}
function saveStore(records) {
  localStorage.setItem(STORE_KEY, JSON.stringify(records));
}

$("btn-save").addEventListener("click", () => {
  if (!lastRequest) return;
  const records = loadStore();
  const id = records.length ? Math.max(...records.map((r) => r.id)) + 1 : 1;
  records.push({
    id, created_at: new Date().toISOString(),
    request: lastRequest, result: lastResult,
  });
  try {
    saveStore(records);
    $("save-status").textContent = `✓ Kaydedildi (Kayıt #${id})`;
  } catch {
    $("save-status").textContent = "✗ Tarayıcı deposu dolu — eski kayıtları dışa aktarıp silin.";
  }
});

$("nav-new").addEventListener("click", () => switchView("new"));
$("nav-records").addEventListener("click", () => { switchView("records"); renderRecords(); });

function switchView(v) {
  $("view-new").classList.toggle("hidden", v !== "new");
  $("view-records").classList.toggle("hidden", v !== "records");
  $("nav-new").classList.toggle("active", v === "new");
  $("nav-records").classList.toggle("active", v === "records");
  if (v === "records") $("report-holder").classList.add("hidden");
  else if (lastResult) $("report-holder").classList.remove("hidden");
}

function renderRecords() {
  const records = loadStore().slice().reverse();
  const table = $("records-table");
  $("records-empty").classList.toggle("hidden", records.length > 0);
  if (!records.length) { table.innerHTML = ""; return; }
  const rows = [`<tr><th>#</th><th>Tarih</th><th>Rapor No</th><th>YİBF</th>
    <th class="left">Şantiye</th><th>Eleman</th><th>Sınıf</th><th>Sonuç</th><th></th></tr>`];
  for (const r of records) {
    const p = r.request.project || {};
    rows.push(`<tr class="rec" data-id="${r.id}">
      <td>${r.id}</td>
      <td>${new Date(r.created_at).toLocaleDateString("tr-TR")}</td>
      <td>${escapeHtml(p.rapor_no || "—")}</td>
      <td>${escapeHtml(p.yibf_no || "—")}</td>
      <td class="left">${escapeHtml(p.santiye_adresi || "—")}</td>
      <td>${escapeHtml(p.yapi_elemani || "—")}</td>
      <td>${escapeHtml(r.request.concrete_class)}</td>
      <td><strong>${escapeHtml(r.result.verdict)}</strong></td>
      <td><button class="btn small btn-del" data-id="${r.id}">Sil</button></td></tr>`);
  }
  table.innerHTML = rows.join("");
  table.querySelectorAll("tr.rec").forEach((tr) => {
    tr.addEventListener("click", (e) => {
      if (e.target.classList.contains("btn-del")) return;
      openRecord(Number(tr.dataset.id));
    });
  });
  table.querySelectorAll(".btn-del").forEach((b) => {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = Number(b.dataset.id);
      if (!confirm(`#${id} numaralı kayıt silinsin mi?`)) return;
      saveStore(loadStore().filter((r) => r.id !== id));
      renderRecords();
    });
  });
}

function openRecord(id) {
  const rec = loadStore().find((r) => r.id === id);
  if (!rec) return;
  const { request, result } = rec;
  for (const f of PROJECT_FIELDS) {
    if ($("f-" + f)) $("f-" + f).value = (request.project && request.project[f]) || "";
  }
  $("f-concrete_class").value = request.concrete_class;
  $("f-basis").value = request.basis;
  $("f-volume").value = request.volume_m3 ?? "";
  $("groups-body").innerHTML = "";
  for (const g of request.groups) {
    addGroupRows({ group_no: g.group_no, values: g.values });
  }
  lastRequest = request;
  lastResult = result;
  switchView("new");
  showResult(request, result);
}

/* dışa / içe aktarma */
$("btn-export-all").addEventListener("click", () => {
  const records = loadStore();
  if (!records.length) { alert("Dışa aktarılacak kayıt yok."); return; }
  download("beton-kayitlari-" + new Date().toISOString().slice(0, 10) + ".json",
           JSON.stringify(records, null, 1), "application/json;charset=utf-8");
});
$("btn-import").addEventListener("click", () => $("import-input").click());
$("import-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const incoming = JSON.parse(await file.text());
    if (!Array.isArray(incoming)) throw new Error("Beklenen biçim: kayıt listesi.");
    const records = loadStore();
    let nextId = records.length ? Math.max(...records.map((r) => r.id)) + 1 : 1;
    let added = 0;
    for (const r of incoming) {
      if (!r || !r.request || !r.result) continue;
      records.push({ id: nextId++, created_at: r.created_at || new Date().toISOString(),
                     request: r.request, result: r.result });
      added++;
    }
    saveStore(records);
    renderRecords();
    alert(`${added} kayıt içe aktarıldı.`);
  } catch (err) {
    alert("İçe aktarma hatası: " + err.message);
  } finally {
    e.target.value = "";
  }
});

/* ---------------- yardımcılar ---------------- */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

init();
