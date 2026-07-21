/*
 * Beton basınç dayanımı değerlendirme motoru (tarayıcıda çalışır, tamamen yerel).
 *
 * Dayanaklar:
 *  [1] TS 500 (Şubat 2000) m.3.4 — 26.10.2002 tadili ile TS EN 206 denetim
 *      kriterlerine atıf: n=1 -> 1. kriter uygulanamaz, fci >= fck;
 *      n=2..4 -> fcm >= fck+1,0 ; n>=5 -> fcm >= fck+2,0 ; her fci >= fck-4,0.
 *  [2] TS 13515 Ek B1 — grup içi (max-min) farkı ortalamanın %15'ini aşarsa
 *      en düşük değer atılır, kalanla tekrar kontrol edilir; yine aşarsa grup
 *      sonucu geçersizdir.
 *  [3] TS EN 206 Çizelge 14 (başlangıç imalatı, bilgi amaçlı): fcm >= fck+4.
 *  [4] TS EN 12390-3 — deney yaşı 28 gün.
 *
 * Bu modül app/evaluation.py'nin birebir JavaScript karşılığıdır; sayısal
 * davranış tests/vectors.json üzerinden Python referans motoruyla çapraz
 * doğrulanır. Karşılaştırmalar 0,1 MPa hassasiyetine yuvarlanarak yapılır.
 */
"use strict";

export const CONCRETE_CLASSES = {
  "C8/10": [8, 10], "C12/15": [12, 15], "C16/20": [16, 20],
  "C20/25": [20, 25], "C25/30": [25, 30], "C30/37": [30, 37],
  "C35/45": [35, 45], "C40/50": [40, 50], "C45/55": [45, 55],
  "C50/60": [50, 60], "C55/67": [55, 67], "C60/75": [60, 75],
  "C70/85": [70, 85], "C80/95": [80, 95], "C90/105": [90, 105],
  "C100/115": [100, 115],
};

export const EK_B1_RATIO = 0.15;

const EPS = 1e-9;

/** 0,1 MPa hassasiyetine yuvarla (laboratuvar raporlama hassasiyeti). */
export function r1(x) {
  return Math.round((x + EPS) * 10) / 10;
}

export function parseConcreteClass(text) {
  if (!text) throw new Error("Beton sınıfı boş olamaz.");
  let key = String(text).toUpperCase().replace(/\s+/g, "").replace(/İ/g, "I");
  if (!key.startsWith("C")) key = "C" + key;
  if (key in CONCRETE_CLASSES) return key;
  if (!key.includes("/")) {
    const fck = parseInt(key.slice(1), 10);
    if (!Number.isNaN(fck)) {
      for (const [name, [cyl]] of Object.entries(CONCRETE_CLASSES)) {
        if (cyl === fck) return name;
      }
    }
  }
  throw new Error(`Bilinmeyen beton sınıfı: ${text}`);
}

/** TS 13515 Ek B1 grup içi tutarlılık kontrolü [2]. */
export function evaluateGroup(groupNo, values) {
  const vals = (values || []).filter((v) => v !== null && v !== undefined && v !== "")
    .map(Number);
  const g = {
    group_no: String(groupNo), values: vals, n_specimens: vals.length,
    mean_initial: null, range_initial: null, limit_initial: null,
    within_limit: true, discarded_value: null, values_used: [],
    mean_final: null, range_final: null, limit_final: null,
    valid: false, note: "",
  };

  if (!vals.length) {
    g.note = "Numune sonucu girilmemiş.";
    return g;
  }
  if (vals.some((v) => !(v > 0) || Number.isNaN(v))) {
    g.note = "Sıfır veya negatif dayanım değeri girilemez.";
    return g;
  }
  if (vals.length === 1) {
    g.mean_initial = g.mean_final = r1(vals[0]);
    g.values_used = vals;
    g.valid = true;
    g.note = "Tek numune — grup içi %15 kontrolü uygulanamaz.";
    return g;
  }

  const mean0 = vals.reduce((a, b) => a + b, 0) / vals.length;
  const rng0 = Math.max(...vals) - Math.min(...vals);
  const lim0 = EK_B1_RATIO * mean0;
  g.mean_initial = r1(mean0);
  g.range_initial = r1(rng0);
  g.limit_initial = r1(lim0);
  g.within_limit = rng0 <= lim0 + EPS;

  if (g.within_limit) {
    g.values_used = vals;
    g.mean_final = r1(mean0);
    g.valid = true;
    g.note = "Fark ortalamanın %15'i içinde — sonuçlar geçerli.";
    return g;
  }
  if (vals.length === 2) {
    g.note = "İki numune arasındaki fark ortalamanın %15'ini aşıyor — " +
             "TS 13515 Ek B1 gereği grup sonuçları geçersiz.";
    return g;
  }

  const discarded = Math.min(...vals);
  const remaining = [...vals].sort((a, b) => a - b).slice(1);
  g.discarded_value = discarded;
  const mean1 = remaining.reduce((a, b) => a + b, 0) / remaining.length;
  const rng1 = Math.max(...remaining) - Math.min(...remaining);
  const lim1 = EK_B1_RATIO * mean1;
  g.range_final = r1(rng1);
  g.limit_final = r1(lim1);

  if (rng1 <= lim1 + EPS) {
    g.values_used = remaining;
    g.mean_final = r1(mean1);
    g.valid = true;
    g.note = `Fark %15 sınırını aştığından en düşük değer (${discarded.toFixed(1)} ` +
             "MPa) atıldı; kalan sonuçlar geçerli (TS 13515 Ek B1).";
  } else {
    g.note = "En düşük değer atıldıktan sonra da fark ortalamanın %15'ini " +
             "aşıyor — grup sonuçları geçersiz (TS 13515 Ek B1).";
  }
  return g;
}

function isoToDate(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

/**
 * Ana değerlendirme.
 * options: { concreteClass, basis: 'silindir'|'kup', groups: [{group_no,
 *   values}], volumeM3?, samplingDate?, testDate? }  (tarihler ISO 'YYYY-MM-DD')
 */
export function evaluate(opts) {
  const cls = parseConcreteClass(opts.concreteClass);
  const [fckCyl, fckCube] = CONCRETE_CLASSES[cls];
  let basis = String(opts.basis || "").trim().toLowerCase();
  let fck;
  if (["silindir", "cylinder", "cyl"].includes(basis)) {
    basis = "silindir"; fck = fckCyl;
  } else if (["kup", "küp", "cube"].includes(basis)) {
    basis = "kup"; fck = fckCube;
  } else {
    throw new Error(`Değerlendirme esası 'silindir' veya 'kup' olmalı: ${opts.basis}`);
  }

  const res = {
    concrete_class: cls, basis, fck,
    fck_cylinder: fckCyl, fck_cube: fckCube,
    groups: [], n_valid: 0, n_invalid: 0,
    fcm: null, fci_min: null,
    criterion1: null, criterion2: null, ts500_conform: null,
    en206_initial: null,
    age_days: null, warnings: [], recommendations: [], verdict: "",
  };

  (opts.groups || []).forEach((gd, i) => {
    const gno = String(gd.group_no || i + 1);
    res.groups.push(evaluateGroup(gno, gd.values || []));
  });

  const valid = res.groups.filter((g) => g.valid);
  const invalid = res.groups.filter((g) => !g.valid);
  res.n_valid = valid.length;
  res.n_invalid = invalid.length;

  for (const g of invalid) {
    res.warnings.push(`Grup ${g.group_no}: sonuç geçersiz — ${g.note}`);
  }

  const n = res.n_valid;
  if (n === 0) {
    res.verdict = "DEĞERLENDİRİLEMEDİ";
    res.warnings.push("Geçerli grup sonucu bulunmadığından basınç dayanımı " +
                      "uygunluk değerlendirmesi yapılamadı.");
    res.recommendations.push(
      "Geçerli deney sonucu elde edilemediğinden, ilgili fenni mesulün " +
      "talebiyle yapıdaki beton dayanımı TS EN 13791 kapsamında karot ve " +
      "tahribatsız yöntemlerle belirlenmelidir.");
    return res;
  }

  const fcis = valid.map((g) => g.mean_final);
  res.fcm = r1(fcis.reduce((a, b) => a + b, 0) / n);
  res.fci_min = r1(Math.min(...fcis));

  // --- 1. Kriter (ortalama) [1] ---
  if (n === 1) {
    res.criterion1 = {
      label: "1. Kriter (fcm)", applicable: false, passed: null,
      threshold: null, value: null,
      detail: "n = 1 olduğundan 1. kriter uygulanamaz (TS 500 m.3.4).",
    };
  } else {
    const margin = n <= 4 ? 1.0 : 2.0;
    const thr = r1(fck + margin);
    const ok = res.fcm >= thr - EPS;
    res.criterion1 = {
      label: "1. Kriter (fcm)", applicable: true, passed: ok,
      threshold: thr, value: res.fcm, margin,
      detail: `n = ${n} için fcm >= fck + ${margin.toFixed(0)} → ` +
              `${res.fcm.toFixed(1)} MPa ${ok ? "≥" : "<"} ${thr.toFixed(1)} MPa`,
    };
  }

  // --- 2. Kriter (tekil sonuçlar) [1] ---
  const thr2 = n === 1 ? r1(fck) : r1(fck - 4.0);
  const label2 = n === 1 ? "fci >= fck" : "fci >= fck - 4";
  const failing = valid.filter((g) => g.mean_final < thr2 - EPS);
  const ok2 = failing.length === 0;
  const failTxt = failing.length
    ? " Sağlamayan gruplar: " +
      failing.map((g) => `${g.group_no} (${g.mean_final.toFixed(1)} MPa)`).join(", ")
    : "";
  res.criterion2 = {
    label: "2. Kriter (fci)", applicable: true, passed: ok2,
    threshold: thr2, value: res.fci_min,
    failing_groups: failing.map((g) => g.group_no),
    detail: `${label2} → en düşük grup sonucu ${res.fci_min.toFixed(1)} MPa ` +
            `${ok2 ? "≥" : "<"} ${thr2.toFixed(1)} MPa.${failTxt}`,
  };

  const c1ok = res.criterion1.passed !== false;
  res.ts500_conform = Boolean(c1ok && ok2);
  res.verdict = res.ts500_conform ? "UYGUN" : "UYGUN DEĞİL";

  // --- TS EN 206 Çizelge 14 (bilgi amaçlı) [3] ---
  if (n >= 3) {
    const thrI = r1(fck + 4.0);
    const okI = res.fcm >= thrI - EPS && res.fci_min >= r1(fck - 4.0) - EPS;
    res.en206_initial = {
      label: "TS EN 206 Çizelge 14 (başlangıç imalatı — bilgi amaçlı)",
      applicable: true, passed: okI, threshold: thrI, value: res.fcm,
      detail: `fcm >= fck + 4 ve fci >= fck - 4 → fcm ${res.fcm.toFixed(1)} MPa, ` +
              `en düşük fci ${res.fci_min.toFixed(1)} MPa ` +
              `(${okI ? "sağlanıyor" : "sağlanmıyor"}).`,
    };
  }

  // --- Numune yaşı [4] ---
  const d0 = isoToDate(opts.samplingDate);
  const d1 = isoToDate(opts.testDate);
  if (d0 !== null && d1 !== null) {
    const age = Math.round((d1 - d0) / 86400000);
    res.age_days = age;
    if (age !== 28) {
      res.warnings.push(
        `Numune yaşı ${age} gün — 28 günlük standart deney yaşından farklı. ` +
        "Değerlendirme 28 günlük dayanım esasına göredir (TS EN 12390-3).");
    }
  }

  // --- Numune sayısı bilgilendirmesi (TS 500 m.3.4) [1] ---
  const vol = Number(opts.volumeM3);
  if (vol > 0) {
    const expected = Math.max(3, Math.ceil(vol / 100));
    if (res.groups.length < expected) {
      res.warnings.push(
        `${vol.toFixed(0)} m³ beton için TS 500 m.3.4 esasına göre en az ` +
        `${expected} grup (her 100 m³ veya 450 m² döşeme için 1 grup, işte ` +
        `en az 3 grup) beklenir; raporda ${res.groups.length} grup var.`);
    }
  }

  if (!res.ts500_conform) {
    res.recommendations.push(
      "Basınç dayanımı sonuçları TS 500 m.3.4 / TS EN 206 denetim " +
      "kriterlerini sağlamamaktadır. İlgili idareye ve yapı denetim kuruluşu " +
      "denetçi mimar/mühendisine yazılı bildirim yapılmalıdır.",
      "İlgili fenni mesulün talebiyle yapıdaki beton dayanımı TS EN 13791 " +
      "kapsamında belirlenmelidir: yapıya zarar vermeyecek noktalardan karot " +
      "alınması ve/veya TS 13543 kapsamındaki tahribatsız (beton çekici, " +
      "ultrases vb.) yöntemlerle değerlendirme yapılması önerilir.",
      "Karot değerlendirmesinde şüpheli bölge için yaygın uygulama: en düşük " +
      "karot dayanımının 0,85·(fck − 4) değerinden büyük olması koşulunun " +
      "kontrolü (TS EN 13791 / 2019 yaklaşımı).",
      "Uygunsuz beton dökümüne devam edilmemeli; üretici firmanın G uygunluk " +
      "belgesi kapsamındaki üretim kontrol kayıtları istenmelidir.");
  }
  if (res.n_invalid) {
    res.recommendations.push(
      "Geçersiz grup sonuçları için numune alma, saklama, kür ve deney " +
      "süreçleri (TS EN 12350-1, TS EN 12390-2) gözden geçirilmeli; " +
      "gerekirse laboratuvardan açıklama istenmelidir.");
  }
  return res;
}
