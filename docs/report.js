/*
 * Akademik biçimli, madde referanslı değerlendirme raporu üreticisi.
 * Tamamen siyah-beyaz, ciddi/profesyonel dizgi; tüm hesap adımları sayısal
 * olarak gösterilir ve her adım kaynakçadaki standart maddesine bağlanır.
 */
"use strict";

/* ---------------- kaynakça ---------------- */
export const REFERENCES = [
  "TS 500 (Şubat 2000), “Betonarme Yapıların Tasarım ve Yapım Kuralları”, " +
  "Türk Standardları Enstitüsü; madde 3.4 (beton kalite denetimi), 26.10.2002 " +
  "tarihli tadil ile TS EN 206 denetim kriterlerine atıf.",
  "TS EN 206:2013+A2, “Beton — Özellik, Performans, İmalat ve Uygunluk”, " +
  "Türk Standardları Enstitüsü; madde 8.2.1 ve Çizelge 14 (basınç dayanımı " +
  "uygunluk kriterleri).",
  "TS 13515:2021 (+T1), “TS EN 206'nın Uygulamasına Yönelik Tamamlayıcı " +
  "Standard”, Türk Standardları Enstitüsü; Ek B1 (numune takımı ve deney " +
  "sonucu tanımı, tek beton yükünden asgari 2 takım kuralı, %15 kuralı), " +
  "Çizelge B1.1 (numune alma planı) ve B1.3 (kabul kriterleri).",
  "TS EN 12350-1, “Taze Beton Deneyleri — Bölüm 1: Numune Alma”, TSE.",
  "TS EN 12390-2, “Sertleşmiş Beton Deneyleri — Bölüm 2: Dayanım Deneylerinde " +
  "Kullanılacak Numunelerin Hazırlanması ve Küre Tabi Tutulması”, TSE.",
  "TS EN 12390-3, “Sertleşmiş Beton Deneyleri — Bölüm 3: Deney Numunelerinin " +
  "Basınç Dayanımının Tayini”, TSE.",
  "TS EN 13791:2019, “Beton Basınç Dayanımının Yapılarda ve Öndökümlü Beton " +
  "Bileşenlerde Yerinde Tayini”, TSE.",
  "4708 sayılı Yapı Denetimi Hakkında Kanun ve Yapı Denetimi Uygulama Yönetmeliği.",
  "4708 sayılı Kanun kapsamında denetimi yürütülen yapılara ait taze betondan " +
  "numune alınması, deneylerinin yapılması, raporlanması süreçlerinin izlenmesi " +
  "ve denetlenmesine dair Tebliğ (R.G. 18.12.2018/30629; değişik 22.02.2024).",
  "Çevre, Şehircilik ve İklim Değişikliği Bakanlığı Genelgesi 2022/07 " +
  "(13.04.2022, sayı 3438325), “Taze Beton Dökümleri” — numune sayıları; tek " +
  "beton yükü teslimatında toplam 8 numune (2 adet 7 günlük, 6 adet 28 günlük).",
];
// Metin içi işaretler
const R = { TS500: 1, EN206: 2, TS13515: 3, N12350: 4, N12390_2: 5,
            N12390_3: 6, N13791: 7, KANUN: 8, TEBLIG: 9, GENELGE: 10 };
const cite = (...nums) => `<span class="cite">[${nums.join(", ")}]</span>`;

/* ---------------- yardımcılar ---------------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dash = (s) => (s === null || s === undefined || s === "" ? "—" : esc(s));
/** Türkçe ondalık gösterim: 46 -> "46,0" */
const f1 = (x) => (x === null || x === undefined ? "—"
  : x.toFixed(1).replace(".", ","));
const joinVals = (vals, sep = "; ") => vals.map(f1).join(sep);
const trDate = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = String(iso).split("-");
  return `${d}.${m}.${y}`;
};
const FCK = "<i>f</i><sub>ck</sub>";
const FCM = "<i>f</i><sub>cm</sub>";
const FCI = "<i>f</i><sub>c,i</sub>";
const XBAR = "<i>x̄</i>";

/* ---------------- bölüm 1: bilgi tablosu ---------------- */
function infoSection(req) {
  const p = req.project || {};
  const rows = [
    ["Rapor No", p.rapor_no, "YİBF No", p.yibf_no],
    ["Laboratuvar", p.lab_adi, "Lab. İzin Belge No", p.lab_izin_belge_no],
    ["Yapı Denetim Kuruluşu", p.deney_isteyen, "Müteahhit", p.muteahhit],
    ["Yapı Sahibi", p.yapi_sahibi, "Beton Üreticisi", p.uretici_firma],
    ["Şantiye Adresi", p.santiye_adresi, "Pafta / Ada / Parsel", p.pafta_ada_parsel],
    ["Yapı Elemanı", p.yapi_elemani, "Kat / Kot / Blok", p.kat_kot_blok],
    ["Beton Sınıfı", req.concrete_class,
     "Beton Miktarı", req.volume_m3 ? `${req.volume_m3} m³` : null],
    ["Numune Boyut / Şekil", p.numune_boyut_sekil,
     "Değerlendirme Esası", req.basis === "silindir"
       ? "Silindir (150×300 mm eşdeğeri)" : "Küp (150 mm eşdeğeri)"],
    ["Numune Alınış Tarihi", trDate(p.alinis_tarihi),
     "28 Gün Deney Tarihi", trDate(p.deney_tarihi)],
  ];
  return `<section class="rp-sec">
    <h2>1. Rapor ve Şantiye Bilgileri</h2>
    <table class="rp-info">${rows.map(([k1, v1, k2, v2]) =>
      `<tr><td class="k">${k1}</td><td>${dash(v1)}</td>
           <td class="k">${k2}</td><td>${dash(v2)}</td></tr>`).join("")}
    </table>
  </section>`;
}

/* ---------------- bölüm 2: simgeler, esas, yöntem ---------------- */
function methodSection(req, res) {
  const symbols = [
    [FCK, `Karakteristik basınç dayanımı (${req.basis === "silindir"
      ? "150×300 mm silindir" : "150 mm küp"} esası) [MPa]`],
    [`<i>x</i><sub>j,i</sub>`, "j numaralı gruptaki i numaralı tekil numune sonucu [MPa]"],
    [`${XBAR}<sub>j</sub>`, "j grubundaki tekil sonuçların aritmetik ortalaması [MPa]"],
    [`<i>r</i><sub>j</sub>`, "j grubunda en büyük ve en küçük tekil sonuç farkı [MPa]"],
    [FCI, "Geçerli grup (deney) sonucu — grup ortalaması [MPa]"],
    [FCM, `Geçerli <i>n</i> adet grup sonucunun ortalaması [MPa]`],
    ["<i>n</i>", "Uygunluk değerlendirmesine giren geçerli grup sonucu adedi [–]"],
  ];
  const marginTxt = res.n_valid <= 1 ? ""
    : res.n_valid <= 4 ? "1,0" : "2,0";
  return `<section class="rp-sec">
    <h2>2. Değerlendirme Esasları, Simgeler ve Yöntem</h2>

    <h3>2.1 Simgeler</h3>
    <table class="rp-table rp-sym">
      <tr><th style="width:18%">Simge</th><th class="left">Tanım</th></tr>
      ${symbols.map(([s, t]) =>
        `<tr><td>${s}</td><td class="left">${t}</td></tr>`).join("")}
    </table>

    <h3>2.2 Değerlendirme Esası</h3>
    <p>Laboratuvar deney raporundaki tekil basınç dayanımı sonuçları
    ${req.basis === "silindir"
      ? "150×300 mm standart silindir dayanımına eşdeğer"
      : "150 mm standart küp dayanımına eşdeğer"} kabul edilmiş; buna göre
    ${res.concrete_class} sınıfı için karakteristik dayanım
    ${FCK} = ${f1(res.fck)} MPa alınmıştır ${cite(R.EN206)}. Deney numuneleri
    TS EN 12350-1'e göre alınmış, TS EN 12390-2'ye göre küre tabi tutulmuş ve
    28 günlük basınç dayanımları TS EN 12390-3'e göre tayin edilmiş kabul
    edilir ${cite(R.N12350, R.N12390_2, R.N12390_3)}.</p>

    <h3>2.3 Grup İçi Tutarlılık Kontrolü — TS 13515 Ek B1</h3>
    <p>Aynı harmandan (transmikserden) alınan numune takımı bir
    <em>grup</em> oluşturur; bir deney sonucu, bir beton yükünden alınan en az
    üç numunelik takımın ortalamasıdır ${cite(R.TS13515)}. Şantiyeye aynı gün
    içerisinde yalnızca <em>bir</em> beton yükü teslim edilmişse bu yükten
    asgari 2 numune takımı oluşturulur (toplam 8 numune: 2 adet 7 günlük,
    6 adet 28 günlük); 28 günlük sonuçlar 3'erli takımlara ayrılarak her takım
    ayrı bir deney sonucu sayılır ${cite(R.TS13515, R.GENELGE)}. Her j grubu
    için ${cite(R.TS13515)}:</p>
    <div class="rp-formula">
      <div class="eq"><span>${XBAR}<sub>j</sub> = (1/<i>k</i><sub>j</sub>) ·
        Σ <i>x</i><sub>j,i</sub></span><span class="eq-no">(1)</span></div>
      <div class="eq"><span><i>r</i><sub>j</sub> = max(<i>x</i><sub>j,i</sub>) −
        min(<i>x</i><sub>j,i</sub>)</span><span class="eq-no">(2)</span></div>
      <div class="eq"><span>Geçerlilik koşulu:&nbsp; <i>r</i><sub>j</sub> ≤
        0,15 · ${XBAR}<sub>j</sub></span><span class="eq-no">(3)</span></div>
    </div>
    <p>Koşul (3) sağlanmazsa gruptaki <strong>en düşük</strong> tekil sonuç
    değerlendirme dışı bırakılır ve (1)–(3) kalan sonuçlarla yinelenir; koşul
    yine sağlanmazsa grubun tüm sonuçları geçersiz sayılır ve grup, uygunluk
    değerlendirmesine katılmaz ${cite(R.TS13515)}. Koşulu sağlayan grubun
    sonucu ${FCI} = ${XBAR}<sub>j</sub> olarak alınır.</p>

    <h3>2.4 Uygunluk (Kabul) Kriterleri — TS 500 m.3.4 / TS EN 206</h3>
    <p>Geçerli <i>n</i> adet grup sonucu için ortalama dayanım:</p>
    <div class="rp-formula">
      <div class="eq"><span>${FCM} = (1/<i>n</i>) · Σ ${FCI}</span>
        <span class="eq-no">(4)</span></div>
    </div>
    <p>TS 500 m.3.4'te (26.10.2002 tadili ile TS EN 206'ya atıfla) verilen ve
    her ikisi de <em>aynı anda</em> sağlanması zorunlu denetim kriterleri
    ${cite(R.TS500, R.EN206)}:</p>
    <table class="rp-table">
      <tr><th><i>n</i></th><th>1. Kriter (ortalama)</th>
          <th>2. Kriter (herhangi tek sonuç)</th></tr>
      <tr><td>1</td><td>Uygulanamaz</td><td>${FCI} ≥ ${FCK}</td></tr>
      <tr><td>2 – 4</td><td>${FCM} ≥ ${FCK} + 1,0</td>
          <td>${FCI} ≥ ${FCK} − 4,0</td></tr>
      <tr><td>≥ 5</td><td>${FCM} ≥ ${FCK} + 2,0</td>
          <td>${FCI} ≥ ${FCK} − 4,0</td></tr>
    </table>
    ${res.n_valid > 1 ? `<p>Bu değerlendirmede <i>n</i> = ${res.n_valid}
      olduğundan 1. kriter için pay ${marginTxt} MPa alınmıştır.</p>` : ""}
  </section>`;
}

/* ---------------- bölüm 3: grup hesapları ---------------- */
function derivBox(title, steps) {
  return `<div class="rp-deriv">
    <div class="rp-deriv-h">${title}</div>
    ${steps.map((s) => `<div class="rp-step">${s}</div>`).join("\n")}
  </div>`;
}

function groupDerivation(g) {
  const k = g.values.length;
  if (k === 0) {
    return derivBox(`Grup ${esc(g.group_no)}`,
      ["Numune sonucu bulunmadığından değerlendirilememiştir."]);
  }
  if (k === 1) {
    return derivBox(`Grup ${esc(g.group_no)}`,
      [`Tek numune sonucu (${f1(g.values[0])} MPa) bulunduğundan denklem (3)
        kontrolü uygulanamaz; ${FCI} = <strong>${f1(g.mean_final)} MPa</strong>
        alınmıştır.`]);
  }
  const title = `Grup ${esc(g.group_no)} — tekil sonuçlar
    <i>x</i> = {${joinVals(g.values)}} MPa`;
  const mx = Math.max(...g.values), mn = Math.min(...g.values);
  const steps = [
    `Denk. (1): ${XBAR} = (${joinVals(g.values, " + ")}) / ${k} =
      <strong>${f1(g.mean_initial)} MPa</strong>`,
    `Denk. (2): <i>r</i> = ${f1(mx)} − ${f1(mn)} =
      <strong>${f1(g.range_initial)} MPa</strong>;&nbsp;
      sınır değeri 0,15 · ${XBAR} = 0,15 · ${f1(g.mean_initial)} =
      <strong>${f1(g.limit_initial)} MPa</strong>`,
  ];

  if (g.within_limit) {
    steps.push(`Denk. (3): ${f1(g.range_initial)} ≤ ${f1(g.limit_initial)} →
      koşul <u>sağlanır</u>; grup sonucu ${FCI} =
      <strong>${f1(g.mean_final)} MPa</strong> ${cite(R.TS13515)}.`);
    return derivBox(title, steps);
  }

  steps.push(`Denk. (3): ${f1(g.range_initial)} &gt; ${f1(g.limit_initial)} →
    koşul <u>sağlanmaz</u>. TS 13515 Ek B1 uyarınca en düşük tekil sonuç
    (${f1(g.discarded_value)} MPa) değerlendirme dışı bırakılır ${cite(R.TS13515)}.`);

  const rem = g.values_used.length ? g.values_used
    : [...g.values].sort((a, b) => a - b).slice(1);
  const mean2 = g.valid ? g.mean_final
    : Math.round((rem.reduce((a, b) => a + b, 0) / rem.length + 1e-9) * 10) / 10;
  steps.push(`Kalan sonuçlar {${joinVals(rem)}} MPa için yinelenen kontrol:
    ${XBAR}′ = ${f1(mean2)} MPa;&nbsp; <i>r</i>′ = ${f1(g.range_final)} MPa;&nbsp;
    0,15 · ${XBAR}′ = ${f1(g.limit_final)} MPa`);

  if (g.valid) {
    steps.push(`${f1(g.range_final)} ≤ ${f1(g.limit_final)} → koşul (3)
      <u>sağlanır</u>; grup sonucu ${FCI} =
      <strong>${f1(g.mean_final)} MPa</strong> olarak alınır ${cite(R.TS13515)}.`);
  } else {
    steps.push(`${f1(g.range_final)} &gt; ${f1(g.limit_final)} → koşul (3)
      <u>yine sağlanmaz</u>; grubun tüm sonuçları <strong>geçersiz</strong>
      sayılır ve grup uygunluk değerlendirmesine katılmaz ${cite(R.TS13515)}.`);
  }
  return derivBox(title, steps);
}

function groupsSection(res) {
  const rows = res.groups.map((g) => `<tr>
    <td>${esc(g.group_no)}</td>
    <td>${g.values.length ? joinVals(g.values, " / ") : "—"}</td>
    <td>${f1(g.mean_initial)}</td>
    <td>${f1(g.range_initial)}</td>
    <td>${f1(g.limit_initial)}</td>
    <td>${g.discarded_value === null ? "—" : f1(g.discarded_value)}</td>
    <td><strong>${f1(g.mean_final)}</strong></td>
    <td>${g.valid ? "Geçerli" : "GEÇERSİZ"}</td></tr>`).join("");
  const notes = (res.notes || []).map((n) =>
    `<p class="rp-note"><em>Açıklama:</em> ${esc(n)}
       ${cite(R.TS13515, R.GENELGE)}</p>`).join("");
  return `<section class="rp-sec">
    <h2>3. Grup İçi Tutarlılık Kontrolü ve Grup Sonuçları
        <span class="secref">(TS 13515 Ek B1 ${cite(R.TS13515)})</span></h2>
    ${notes}
    <table class="rp-table">
      <tr><th>Grup</th><th>Tekil Sonuçlar<br>[MPa]</th><th>${XBAR}<sub>j</sub><br>[MPa]</th>
          <th><i>r</i><sub>j</sub><br>[MPa]</th><th>0,15·${XBAR}<sub>j</sub><br>[MPa]</th>
          <th>Atılan<br>[MPa]</th><th>${FCI}<br>[MPa]</th><th>Durum</th></tr>
      ${rows}
    </table>
    <h3>3.1 İşlem Adımları</h3>
    ${res.groups.map(groupDerivation).join("\n")}
  </section>`;
}

/* ---------------- bölüm 4: uygunluk ---------------- */
function criteriaSection(res) {
  if (res.n_valid === 0) {
    return `<section class="rp-sec">
      <h2>4. Uygunluk Değerlendirmesi
          <span class="secref">(TS 500 m.3.4 ${cite(R.TS500, R.EN206)})</span></h2>
      <p>Geçerli grup sonucu bulunmadığından (denklem (4)–(6)) uygunluk
      değerlendirmesi <strong>yapılamamıştır</strong>. Bölüm 6'daki öneriler
      uyarınca işlem yapılmalıdır.</p>
    </section>`;
  }
  const valid = res.groups.filter((g) => g.valid);
  const fcis = valid.map((g) => g.mean_final);
  const n = res.n_valid;
  let html = `<section class="rp-sec">
    <h2>4. Uygunluk Değerlendirmesi
        <span class="secref">(TS 500 m.3.4 ${cite(R.TS500, R.EN206)})</span></h2>
    <p>Geçerli grup sonucu adedi <i>n</i> = ${n}` +
    (res.n_invalid ? ` (${res.n_invalid} grup, Ek B1 gereği geçersiz olduğundan
      hesaba katılmamıştır)` : "") + `.</p>
    <div class="rp-formula">
      <div class="eq"><span>Denk. (4):&nbsp; ${FCM} =
        (${joinVals(fcis, " + ")}) / ${n} =
        <strong>${f1(res.fcm)} MPa</strong></span></div>
    </div>
    <table class="rp-table" style="max-width: 520px">
      <tr><th>Büyüklük</th><th>Değer</th><th>Büyüklük</th><th>Değer</th></tr>
      <tr><td>${FCK}</td><td>${f1(res.fck)} MPa</td>
          <td><i>n</i></td><td>${n}</td></tr>
      <tr><td>${FCM}</td><td><strong>${f1(res.fcm)} MPa</strong></td>
          <td>min ${FCI}</td><td><strong>${f1(res.fci_min)} MPa</strong></td></tr>
    </table>`;

  // 1. kriter
  if (!res.criterion1.applicable) {
    html += `<p><strong>1. Kriter:</strong> <i>n</i> = 1 olduğundan
      uygulanamaz ${cite(R.TS500)}.</p>`;
  } else {
    const m = res.criterion1.margin ?? (n <= 4 ? 1.0 : 2.0);
    html += `<p><strong>1. Kriter</strong> (<i>n</i> ${n <= 4 ? "= 2–4" : "≥ 5"}
      için ${FCM} ≥ ${FCK} + ${f1(m)}):&nbsp;
      ${f1(res.fcm)} MPa ${res.criterion1.passed ? "≥" : "&lt;"}
      ${f1(res.fck)} + ${f1(m)} = ${f1(res.criterion1.threshold)} MPa →
      <strong>${res.criterion1.passed ? "SAĞLANIR" : "SAĞLANMAZ"}</strong>
      ${cite(R.TS500, R.EN206)}.</p>`;
  }

  // 2. kriter
  const thr = res.criterion2.threshold;
  const rel = n === 1 ? `${FCI} ≥ ${FCK}` : `${FCI} ≥ ${FCK} − 4,0`;
  html += `<p><strong>2. Kriter</strong> (${rel}): en düşük geçerli grup sonucu
    min ${FCI} = ${f1(res.fci_min)} MPa ${res.criterion2.passed ? "≥" : "&lt;"}
    ${f1(thr)} MPa → <strong>${res.criterion2.passed ? "SAĞLANIR" : "SAĞLANMAZ"}</strong>
    ${cite(R.TS500, R.EN206)}.`;
  if (res.criterion2.failing_groups && res.criterion2.failing_groups.length) {
    html += ` Kriteri sağlamayan gruplar: ${res.criterion2.failing_groups
      .map(esc).join(", ")}.`;
  }
  html += `</p>`;

  if (res.en206_initial) {
    html += `<p class="rp-note"><em>Bilgi:</em> TS EN 206 Çizelge 14 başlangıç
      imalatı kriterine göre (${FCM} ≥ ${FCK} + 4,0 ve her ${FCI} ≥ ${FCK} − 4,0):
      ${f1(res.fcm)} MPa ${res.en206_initial.passed ? "≥" : "&lt;"}
      ${f1(res.en206_initial.threshold)} MPa →
      ${res.en206_initial.passed ? "sağlanır" : "sağlanmaz"} ${cite(R.EN206)}.
      Bu kontrol bilgi amaçlıdır; kabul kararı TS 500 m.3.4 kriterlerine göre
      verilmiştir.</p>`;
  }
  html += `</section>`;
  return html;
}

/* ---------------- sonuç + uyarılar + kaynaklar ---------------- */
function conclusionSections(req, res, sectionNo) {
  let no = sectionNo;
  let html = `<section class="rp-sec">
    <h2>${no}. Sonuç</h2>
    <div class="rp-verdict">
      Bu raporda değerlendirilen beton
      (${esc(req.concrete_class)}${req.project?.yapi_elemani
        ? ", " + esc(req.project.yapi_elemani) : ""}), TS 500 m.3.4 / TS EN 206
      denetim kriterlerine göre:&nbsp;
      <strong class="verdict-word">${esc(res.verdict)}</strong>
    </div>`;
  if (res.age_days !== null) {
    html += `<p>Numune yaşı: ${res.age_days} gün
      (standart deney yaşı 28 gün ${cite(R.N12390_3)}).</p>`;
  }
  html += `</section>`;
  no++;

  if (res.warnings.length) {
    html += `<section class="rp-sec"><h2>${no}. Uyarılar</h2>
      <ol class="rp-list">${res.warnings.map((w) =>
        `<li>${esc(w)}</li>`).join("")}</ol></section>`;
    no++;
  }
  if (res.recommendations.length) {
    html += `<section class="rp-sec"><h2>${no}. Öneriler ve Yapılacak İşlemler</h2>
      <ol class="rp-list">${res.recommendations.map((w) =>
        `<li>${esc(w)} ${cite(R.N13791, R.KANUN, R.TEBLIG)}</li>`).join("")}
      </ol></section>`;
    no++;
  }
  html += `<section class="rp-sec"><h2>${no}. Kaynaklar</h2>
    <ol class="rp-refs">${REFERENCES.map((r) => `<li>${r}</li>`).join("")}</ol>
  </section>`;
  return html;
}

/* ---------------- ana üretici ---------------- */
export function buildReportHTML(req, res, generatedAt = new Date()) {
  const p = req.project || {};
  const dt = generatedAt.toLocaleDateString("tr-TR") + " " +
    generatedAt.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });

  return `
  <div class="rp-head">
    <h1>BETON BASINÇ DAYANIMI UYGUNLUK DEĞERLENDİRME RAPORU</h1>
    <p class="rp-sub">TS 500 m.3.4 · TS EN 206 · TS 13515 Ek B1 kapsamında
      değerlendirme${p.rapor_no ? ` — Laboratuvar Rapor No: ${esc(p.rapor_no)}` : ""}</p>
  </div>
  ${infoSection(req)}
  ${methodSection(req, res)}
  ${groupsSection(res)}
  ${criteriaSection(res)}
  ${conclusionSections(req, res, 5)}
  <div class="rp-sign">
    <div class="box"><strong>Değerlendiren</strong>
      <div class="line">${dash(p.degerlendiren)}</div></div>
    <div class="box"><strong>Denetçi / Kontrol</strong>
      <div class="line">Ad Soyad / İmza</div></div>
  </div>
  <div class="rp-foot">
    Bu rapor ${dt} tarihinde, laboratuvar deney raporundaki tekil sonuçlar esas
    alınarak hazırlanmıştır. Hesaplar 0,1 MPa hassasiyetiyle yürütülmüştür.
    Sonuçlar yalnızca ilgili deney raporundaki numuneler için geçerlidir;
    nihai değerlendirme ve bildirim sorumluluğu ilgili denetçi mühendise aittir
    ${cite(R.KANUN, R.TEBLIG)}.
  </div>`;
}

/** Bilgisayara indirilebilir, kendi kendine yeten HTML dosyası üretir. */
export function standaloneReportHTML(req, res, reportCss, generatedAt = new Date()) {
  const title = "Beton Değerlendirme Raporu" +
    (req.project?.rapor_no ? " — " + req.project.rapor_no : "");
  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
body { margin: 24px auto; max-width: 800px; background: #fff; }
${reportCss}
@media print { body { margin: 0; max-width: none; } }
</style>
</head>
<body>
<div class="report-paper">${buildReportHTML(req, res, generatedAt)}</div>
</body>
</html>`;
}
