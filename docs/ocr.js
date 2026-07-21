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

/**
 * Tesseract sonucu -> kelime konumlu satırlar (tablo geri-çatımı için).
 * Düşük güvenli satırlar da korunur: bozuk okunan tablo hücreleri tam da
 * bunların içindedir ve sütun konumu sayesinde yine değerlendirilebilir.
 */
export function structuredFromOcrData(data) {
  const out = [];
  for (const ln of data.lines || []) {
    const words = (ln.words || [])
      .filter((w) => w.text && w.text.trim() && w.bbox)
      .map((w) => ({ text: w.text.trim(), conf: w.confidence, bbox: w.bbox }));
    if (words.length && ln.bbox) out.push({ bbox: ln.bbox, words });
  }
  return out;
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

/**
 * Aydınlatma düzleştirme: kağıt arka planı blok-maksimum + bulanıklaştırma
 * ile kestirilir, her piksel yerel arka planına oranlanır. Gölgeli/eğik
 * ışıklı telefon çekimlerinde tablo bölgesini okunur hale getirir; düzgün
 * taramalarda arka plan zaten tekdüze olduğundan işlem atlanır.
 */
function flattenIllumination(gray, w, h) {
  const K = 24; // blok boyutu (px) — yazı kalınlığından büyük, gölgeden küçük
  const bw = Math.ceil(w / K), bh = Math.ceil(h / K);
  const bg = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let mx = 0;
      const yEnd = Math.min((by + 1) * K, h), xEnd = Math.min((bx + 1) * K, w);
      for (let y = by * K; y < yEnd; y++) {
        const off = y * w;
        for (let x = bx * K; x < xEnd; x++) {
          if (gray[off + x] > mx) mx = gray[off + x];
        }
      }
      bg[by * bw + bx] = mx;
    }
  }
  let lo = 255, hi = 0;
  for (const v of bg) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (hi - lo < 24) return; // tekdüze arka plan (tarama/PDF) — gerek yok
  // 3x3 ortalama (2 geçiş) ile arka plan yumuşatılır
  const tmp = new Float32Array(bg.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const yy = by + dy, xx = bx + dx;
            if (yy >= 0 && yy < bh && xx >= 0 && xx < bw) {
              s += bg[yy * bw + xx]; n++;
            }
          }
        }
        tmp[by * bw + bx] = s / n;
      }
    }
    bg.set(tmp);
  }
  for (let y = 0; y < h; y++) {
    // Çift doğrusal örnekleme için blok koordinatları
    const fy = Math.min(Math.max(y / K - 0.5, 0), bh - 1);
    const y0 = Math.floor(fy), y1 = Math.min(y0 + 1, bh - 1), wy = fy - y0;
    const off = y * w;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(Math.max(x / K - 0.5, 0), bw - 1);
      const x0 = Math.floor(fx), x1 = Math.min(x0 + 1, bw - 1), wx = fx - x0;
      const b = (bg[y0 * bw + x0] * (1 - wx) + bg[y0 * bw + x1] * wx) * (1 - wy) +
                (bg[y1 * bw + x0] * (1 - wx) + bg[y1 * bw + x1] * wx) * wy;
      const v = gray[off + x] * 235 / Math.max(b, 64);
      gray[off + x] = v > 255 ? 255 : v | 0;
    }
  }
}

/** Tuval üzerinde gri tonlama + aydınlatma düzleştirme + kontrast germe. */
export function preprocessCanvas(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const w = canvas.width, h = canvas.height;
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    gray[p] = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
  }
  flattenIllumination(gray, w, h);
  const hist = new Uint32Array(256);
  for (let p = 0; p < gray.length; p++) hist[gray[p]]++;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    d[i] = d[i + 1] = d[i + 2] = gray[p];
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

/**
 * Tuvali OCR'dan geçirir.
 * Dönen: { lines: string[] (başlık alanları için temiz metin),
 *          rows: [{bbox, words}] (numune tablosunun kelime konumlu hali) }.
 */
export async function ocrCanvas(worker, canvas) {
  const { data } = await worker.recognize(preprocessCanvas(canvas));
  return { lines: linesFromOcrData(data), rows: structuredFromOcrData(data) };
}
