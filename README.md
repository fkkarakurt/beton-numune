# Beton Numune Değerlendirme

Yapı denetim ofisleri için beton deney raporu uygunluk değerlendirme sistemi —
**tamamen ücretsiz, sunucusuz (statik) bir web uygulaması**. Tüm PDF okuma ve
hesaplama kullanıcının tarayıcısında yapılır; hiçbir veri dışarı gönderilmez,
hiçbir barındırma/veritabanı maliyeti yoktur.

## Özellikler

- **Otomatik veri çıkarma, tamamen yerel:**
  - Dijital PDF → pdf.js metin katmanı (anında, güvenilir).
  - **Tarama (CamScanner vb.) ve fotoğraf (JPG/PNG/WEBP) → yerleşik OCR**
    (Tesseract.js + Türkçe dil verisi, WebAssembly): metin katmanı yoksa
    otomatik devreye girer; sayfa başına 5-20 sn sürer ve sonuçlar mutlaka
    belgeyle karşılaştırılmalıdır (arayüz bunu zorunlu kılar).
  - Çıkarılanlar: rapor bilgileri, grup/numune sonuçları, silindir/küp
    eşdeğerlik esası.
  - OCR'da numune tablosu **kelime konumlarından (bbox) geri çatılır**:
    "28 Günlük" sütunu başlıktan (okunamazsa sütun konsensüsünden) bulunur,
    her satırda yalnız o sütuna düşen hücre değer sayılır; bozuk okunan
    hücreler ("47 A" = 47,4) ve kalıp numarası bozulan satırlar mikser
    sütunu üzerinden kurtarılır.
- **Deterministik değerlendirme motoru** (`docs/engine.js`):

  | Kontrol | Dayanak |
  |---|---|
  | Grup içi %15 tutarlılık, en düşük değerin atılması | TS 13515 Ek B1 |
  | 1. Kriter: n=2–4 → fcm ≥ fck+1; n≥5 → fcm ≥ fck+2 (n=1: uygulanamaz) | TS 500 m.3.4 (2002 tadili) / TS EN 206 |
  | 2. Kriter: her fci ≥ fck−4 (n=1: fci ≥ fck) | TS 500 m.3.4 / TS EN 206 |
  | Başlangıç imalatı bilgi kriteri: fcm ≥ fck+4 | TS EN 206 Çizelge 14 |
  | Numune yaşı (28 gün) kontrolü | TS EN 12390-3 |
  | Numune alma planı bilgilendirmesi | TS 500 m.3.4 |
  | Uygunsuzlukta karot önerileri | TS EN 13791 |

- **Akademik biçimli rapor** (`docs/report.js`): tüm hesap adımları sayısal
  olarak, denklem numaralarıyla ve standart maddesi atıflarıyla gösterilir;
  atılan numunenin gerekçesi ve yinelenen kontrol adım adım yazılır. Sade,
  siyah-beyaz, imza bloklu A4 dizgi. Kullanıcı raporu **yazdırabilir /
  PDF kaydedebilir**, **bağımsız HTML** veya **JSON** olarak bilgisayarına
  indirebilir.
- **Kayıt arşivi**: tarayıcı yerel deposunda; JSON dışa/içe aktarma ile taşınır.

## Proje yapısı

```
docs/            Yayınlanan statik uygulama (GitHub Pages: /docs)
  engine.js        Değerlendirme motoru (deterministik)
  pdfread.js       Yerel PDF veri çıkarma (pdf.js metin katmanı)
  ocr.js           Tarama/fotoğraf OCR hattı (Tesseract.js, yerel)
  report.js        Akademik rapor üreticisi + kaynakça
  report.css       Rapor dizgisi (siyah-beyaz, A4)
  app.js, index.html, style.css
  vendor/          pdf.js (Mozilla, Apache-2.0) + tesseract.js (Apache-2.0)
                   + Türkçe OCR verisi (~15 MB; ilk OCR kullanımında yüklenir)
app/             Python referans motoru (test oracle'ı — yayınlanmaz)
tests/           Python testleri + Node çapraz doğrulama testleri
```

## Çalıştırma (yerel)

`run.bat` → <http://127.0.0.1:8756> (ES modülleri nedeniyle küçük yerel sunucu
gerekir; internet bağlantısı gerekmez).

## Testler

```
python -m pytest tests -q        # Python referans motoru (25 test)
node tests/js/run_tests.mjs      # JS motoru + PDF okuma + rapor (17 test)
node tests/js/ocr_test.mjs       # OCR hattı uçtan uca (npm install gerektirir)
```

JS motoru, Python referans motorundan üretilen `tests/vectors.json`
vektörleriyle **birebir çapraz doğrulanır**; PDF okuyucu örnek raporun
30 tekil değeriyle uçtan uca test edilir.

## Önemli notlar

- Karşılaştırmalar 0,1 MPa hassasiyetiyle yapılır (laboratuvar raporlama
  hassasiyeti).
- Silindir/küp eşdeğerlik esası raporun dipnotundan otomatik önerilir; son
  karar her zaman kullanıcıya bırakılır (yanlış esas sonucu tersine çevirir).
- Bu araç karar destek amaçlıdır; nihai değerlendirme sorumluluğu ilgili
  denetçi mühendise aittir.
