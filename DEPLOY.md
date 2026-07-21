# Ücretsiz Yayınlama (Micro SaaS)

Uygulama `docs/` klasöründeki **tamamen statik** dosyalardan oluşur: sunucu
yok, veritabanı yok, API yok. Tüm hesap ve PDF okuma kullanıcının
tarayıcısında yapılır; kayıtlar tarayıcının yerel deposunda tutulur.
Bu sayede barındırma maliyeti **sıfırdır** ve ziyaretçi sayısı arttıkça da
sıfır kalır.

## Seçenek 1 — GitHub Pages (önerilen, kalıcı ücretsiz)

1. <https://github.com/new> adresinden yeni bir depo oluşturun:
   - *Repository name*: `beton-numune`
   - Görünürlük: **Public** (ücretsiz Pages için zorunlu)
   - **README, .gitignore, licence EKLEMEYİN** (depo tamamen boş olmalı;
     aksi hâlde ilk push reddedilir).
2. Projeyi gönderin (proje klasöründe):

   ```
   git remote set-url origin https://github.com/fkkarakurt/beton-numune.git
   git push -u origin main
   ```

   (İlk kez remote ekliyorsanız `set-url` yerine `add` kullanılır; `origin`
   zaten tanımlıysa `add` "already exists" hatası verir — `set-url` doğrusudur.)
3. GitHub'da depo → **Settings → Pages**:
   - *Source*: **Deploy from a branch**
   - *Branch*: `main`, klasör: **/docs** → Save
4. 1–2 dakika içinde uygulama şu adreste yayında olur:
   `https://fkkarakurt.github.io/beton-numune/`

> **Gizlilik notu:** `assets/` klasörü (gerçek laboratuvar raporu örneği ve
> Excel) kişisel veri içerdiğinden `.gitignore` ile depo dışında tutulur ve
> commit geçmişinde de yer almaz. Bu dosyalar yalnızca yerel geliştirme ve
> test içindir; yokluklarında ilgili testler otomatik atlanır.

### Kendi alan adınızı bağlama (yalnızca alan adı ücreti)

1. Settings → Pages → **Custom domain** alanına alan adınızı yazın
   (örn. `betondegerlendirme.com`) → Save. Bu işlem depoya `docs/CNAME`
   dosyası ekler.
2. Alan adı sağlayıcınızın DNS panelinde:
   - `www` alt alanı için **CNAME** kaydı → `KULLANICI.github.io`
   - Kök alan (apex) için **A** kayıtları → `185.199.108.153`,
     `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
3. Pages sayfasında **Enforce HTTPS** işaretleyin (ücretsiz SSL otomatik verilir).

### Güncelleme yayınlama

Her değişiklikten sonra:

```
git add -A
git commit -m "aciklama"
git push
```

Pages 1-2 dakika içinde otomatik güncellenir.

## Seçenek 2 — Cloudflare Pages (alternatif, o da ücretsiz)

1. <https://pages.cloudflare.com> → ücretsiz hesap → **Create a project** →
   GitHub deposunu bağlayın.
2. Build ayarları: *Framework preset* = None, *Build command* = boş,
   *Build output directory* = `docs`.
3. Özel alan adı Cloudflare panelinden tek tıkla bağlanır (SSL otomatik).

## Maliyet özeti

| Kalem | Maliyet |
|---|---|
| Barındırma (GitHub/Cloudflare Pages) | 0 ₺ — kalıcı |
| Veritabanı | 0 ₺ — yok (tarayıcı yerel deposu + kullanıcının indirdiği dosyalar) |
| SSL sertifikası | 0 ₺ — otomatik |
| PDF okuma / hesaplama | 0 ₺ — kullanıcının tarayıcısında |
| Alan adı (isteğe bağlı) | yıllık alan adı ücreti (tek ücretli kalem) |

## Notlar

- **Gizlilik avantajı:** hiçbir rapor verisi sunucuya gitmediği için KVKK
  açısından da en temiz mimaridir; pazarlamada vurgulanabilir.
- Kayıtlar tarayıcıya özeldir. Kullanıcılar "Kayıtlar → Tümünü Dışa Aktar" ile
  JSON yedeği alıp başka bilgisayara taşıyabilir.
- Yerel test: `run.bat` (http://127.0.0.1:8756) — ES modülleri `file://`
  üzerinden açılamadığı için küçük yerel sunucu kullanılır.
