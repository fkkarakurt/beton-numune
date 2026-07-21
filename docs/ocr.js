/*
 * Taranmış PDF ve fotoğraflar için tamamen yerel OCR (Tesseract.js, WASM).
 * Türkçe dil verisi dahil tüm dosyalar aynı sunucudan yüklenir; hiçbir veri
 * dışarı gönderilmez, hiçbir ücretli servis kullanılmaz.
 */
"use strict";

const MIN_LINE_CONFIDENCE = 25; // tamamen çöp satırları ele
// Küçük puntolu numune tabloları için yüksek çözünürlük şarttır: A4 sayfa
// ~400 DPI eşdeğerinde (≈3300 px genişlik) işlendiğinde tablo satırları
// güvenilir okunur; 200 DPI'da okunamaz (deneysel olarak doğrulandı).
const TARGET_WIDTH_PDF = 3300;
const TARGET_WIDTH_IMG = 2600;
const MAX_WIDTH = 3600;

/* ------------------------------------------------------------------ */
/* Saf yardımcılar (Node testlerinde de kullanılır)                     */
/* ------------------------------------------------------------------ */
/** Tesseract sonucu -> temiz metin satırları. */
export function linesFromOcrData(data) {
  const lines = [];
  for (const ln of data.lines || []) {
    if (ln.confidence !== undefined && ln.confidence < MIN_LINE_CONFIDENCE) {
      continue;
    }
    const text = String(ln.text || "").replace(/\s+/g, " ").trim();
    if (text) lines.push(text);
  }
  return lines;
}

/* ------------------------------------------------------------------ */
/* Tarayıcı tarafı                                                     */
/* ------------------------------------------------------------------ */
let tesseractScript = null;
let workerPromise = null;

function loadTesseractScript() {
  if (!tesseractScript) {
    tesseractScript = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "./vendor/tesseract/tesseract.min.js";
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("OCR motoru (tesseract.min.js) yüklenemedi."));
      document.head.appendChild(s);
    });
  }
  return tesseractScript;
}

/**
 * Paylaşılan OCR işçisini döndürür (ilk çağrıda motor + Türkçe dil verisi
 * yüklenir; sonraki çağrılar anında döner).
 */
export async function getOcrWorker(onStatus) {
  if (!workerPromise) {
    workerPromise = (async () => {
      onStatus?.("OCR motoru yükleniyor… (ilk kullanımda ~15 MB, tek sefer)");
      await loadTesseractScript();
      const base = new URL("./vendor/tesseract/", window.location.href).href;
      const worker = await window.Tesseract.createWorker("tur", 1, {
        workerPath: base + "worker.min.js",
        corePath: base.replace(/\/$/, ""),
        langPath: base + "lang",
        gzip: true,
        logger: (m) => {
          if (m.status === "recognizing text" && m.progress !== undefined) {
            onStatus?.(`Metin tanınıyor… %${Math.round(m.progress * 100)}`,
                       m.progress);
          }
        },
      });
      // PSM 3 (tam sayfa otomatik bölütleme): tesseract.js'in varsayılanı
      // olan PSM 6 tablolu raporlarda başarısızdır (deneysel karşılaştırma:
      // PSM 6 -> 0/30, PSM 3 -> 28/30 doğru değer).
      await worker.setParameters({
        tessedit_pageseg_mode: "3",
        preserve_interword_spaces: "1",
      });
      return worker;
    })();
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

/** Tuval üzerinde gri tonlama + kontrast germe (kötü çekimler için). */
export function preprocessCanvas(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  // Gri tonlama + min/maks belirleme (uçlardaki %1'i yok say)
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    d[i] = d[i + 1] = d[i + 2] = g;
    hist[g]++;
  }
  const total = canvas.width * canvas.height;
  const cut = total * 0.01;
  let lo = 0, hi = 255, acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > cut) { lo = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > cut) { hi = i; break; } }
  if (hi - lo > 10 && (lo > 12 || hi < 243)) {
    const scale = 255 / (hi - lo);
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.max(0, Math.min(255, (d[i] - lo) * scale));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** pdf.js sayfasını OCR'a uygun çözünürlükte tuvale çizer. */
export async function renderPdfPageToCanvas(page) {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(MAX_WIDTH / base.width,
                         Math.max(1.2, TARGET_WIDTH_PDF / base.width));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

/** Fotoğraf dosyasını (JPG/PNG/WEBP) OCR'a uygun tuvale çizer. */
export async function imageFileToCanvas(file) {
  const bmp = await createImageBitmap(file);
  let scale = 1;
  if (bmp.width < TARGET_WIDTH_IMG) scale = TARGET_WIDTH_IMG / bmp.width;
  if (bmp.width * scale > MAX_WIDTH) scale = MAX_WIDTH / bmp.width;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return canvas;
}

/** Tuvali OCR'dan geçirip metin satırlarını döndürür. */
export async function ocrCanvas(worker, canvas) {
  const { data } = await worker.recognize(preprocessCanvas(canvas));
  return linesFromOcrData(data);
}
