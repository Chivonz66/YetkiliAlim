# GitHub Pages Dağıtımı

Ücretli domain veya harici barındırma **gerekmez**. Site, `https://KULLANICI.github.io/DEPO-ADI/` adresinde yayınlanır. Dağıtım tamamen GitHub Actions ile yapılır; sunucu tarafı (Supabase/Edge) ayrı olarak [kurulum kılavuzunda](kurulum.md) anlatılmıştır.

## 1. GitHub Pages'i etkinleştir

1. GitHub'da depo → **Settings → Pages**.
2. **Build and deployment → Source** alanında **GitHub Actions** seçin. "Deploy from a branch" seçilirse bu iş akışının artefaktı yayınlanmaz.
3. **Settings → Actions → General → Workflow permissions**: "Read and write permissions" açıksa sorun yoktur; iş akışının izinleri zaten dosyada `contents: read`, `pages: write`, `id-token: write` olarak tanımlıdır.
4. Varsayılan dal `master` olmalıdır (iş akışı yalnızca `master` için tetiklenir). Farklı bir dal kullanıyorsanız iş akışındaki `branches:` değerini güncelleyin.

## 2. Depo adı ve taban yol (base path) davranışı

Proje siteleri alt dizinde yayınlanır:

| Depo adı | Site adresi | Vite `base` / `VITE_BASE_PATH` |
| --- | --- | --- |
| `LuminacraftStaffCenter` | `https://KULLANICI.github.io/LuminacraftStaffCenter/` | `/LuminacraftStaffCenter/` |
| `staff-center` | `https://KULLANICI.github.io/staff-center/` | `/staff-center/` |
| `KULLANICI.github.io` (kullanıcı sitesi) | `https://KULLANICI.github.io/` | `/` |

İş akışı bu değeri otomatik üretir:

```yaml
env:
  VITE_BASE_PATH: /${{ github.event.repository.name }}/
```

`vite.config.ts` ayarı `base: process.env.VITE_BASE_PATH || '/'` olduğu için derlenen varlık URL'leri (`/DEPO-ADI/assets/...`) doğru olur. Yerel `.env` dosyasında `VITE_BASE_PATH=/` bırakılmalı; Pages derlemesi ortam değişkenini `.env` değerinin önüne geçirir. Kullanıcı sitesi (repo adı `KULLANICI.github.io`) için iş akışındaki ifade `/KULLANICI.github.io/` üreteceğinden bu özel durumda `VITE_BASE_PATH: /` yapılmalıdır.

## 3. İş akışı nedir, ne yapar?

Dosya: `.github/workflows/deploy-luminacraft-staff-center.yml` (depo kökünde; GitHub yalnızca kökteki `.github` klasörünü okur).

- **Tetikleyici:** `master` dalına `LuminacraftStaffCenter/**` veya iş akışı dosyasının kendisinde değişiklik; ayrıca **Actions → Deploy → Run workflow** ile elle tetikleme.
- **İzinler:** `contents: read`, `pages: write`, `id-token: write`.
- **Eşzamanlılık:** `concurrency.group: pages`, `cancel-in-progress: false` — yayın yarıda kesilmez.
- **Derleme job'u:** `actions/checkout@v4`, `actions/setup-node@v4` (Node 20, npm cache, `LuminacraftStaffCenter/package-lock.json`), sırasıyla `npm ci`, `npm test`, `npm run build`. Ardından 404 dosyası kontrol edilir, `actions/configure-pages@v5` ve `actions/upload-pages-artifact@v3` (`path: LuminacraftStaffCenter/dist`) çalışır.
- **Dağıtım job'u:** `needs: build`, `environment: github-pages` (URL, dağıtım çıktısından alınır), `actions/deploy-pages@v4`.

**404.html notu:** Vite, `public/404.html` dosyasını derleme sırasında otomatik olarak `dist/404.html` içine kopyalar. İş akışındaki Node adımı yalnızca bu dosya yoksa `dist/index.html` dosyasını `dist/404.html` olarak yedekler; böylece `public/404.html` içindeki SPA yönlendirme betiği dağıtımda korunur. Sır: derleme → 404 kontrolü → Pages artefaktı.

**Sır yok:** İş akışında Supabase veya oturum gizli anahtarı bulunmaz. Frontend yalnızca `VITE_` ön ekli, herkese açık değerleri derler; `service_role` yalnızca Supabase Edge Secrets'ta tutulur.

## 4. SPA 404 yönlendirmesi neden gerekli?

React Router istemci tarafı yönlendirme kullanır (`/apply/rehber`, `/status`, `/admin`). Bu adresler sunucuda fiziksel dosya değildir. GitHub Pages bilinmeyen bir yolu istediğinde `404.html` içeriğini döndürür ve adres çubuğu istenen yolda kalır.

Akış:

1. Kullanıcı `/DEPO-ADI/apply/rehber` adresini açar → Pages `404.html` sunar.
2. `public/404.html` içindeki betik, depo önekini ayırıp istemci yolunu (`/apply/rehber`) `encodeURIComponent(path)` ile kodlar ve `/DEPO-ADI/?/%2Fapply%2Frehber` adresine yönlendirir.
3. `/DEPO-ADI/` adresinde gerçek `index.html` sunulur. `index.html` içindeki betik `search.indexOf('?/') === 0` durumunda `decodeURIComponent(search.slice(1))` ile yolu çözer ve `history.replaceState` ile React Router'a doğru rotayı verir.

Kodlama dizeleri (`encodeURIComponent(path)`, `'?/'`, `decodeURIComponent(search.slice(1))`) iki dosyada da birebir aynıdır; `tests/docs-check.test.ts` bunu denetler. Birini değiştirirseniz diğerini de değiştirin.

## 5. Özel alan adı (opsiyonel, gerekli değil)

İsterseniz **Settings → Pages → Custom domain** altında `staff.luminacraft.net` gibi bir alan ekleyebilirsiniz. Bu durumda:

- `ALLOWED_ORIGINS` Edge secret'ına `https://staff.luminacraft.net` adresini ekleyin.
- `CNAME` kaydını ve "Enforce HTTPS" ayarını GitHub arayüzünde onaylayın.
- Taban yol hâlâ depo adına göre hesaplanır; özel alan kullanırken kök dizin yayını için `VITE_BASE_PATH: /` ayarını değerlendirin ve 404 betiğinin depo öneki varsayımını gözden geçirin.

Bu adım **zorunlu değildir**; varsayılan `github.io` adresiyla her şey çalışır.

## 6. Dağıtımı doğrula

1. **Actions** sekmesinde ilgili run'ın yeşil olduğunu kontrol edin (`Derle ve test et` + `GitHub Pages'e yayınla`).
2. `https://KULLANICI.github.io/DEPO-ADI/` adresini açın: başvuru sayfası ve sorular veritabanından geliyor olmalı (mock veri yoktur; Supabase ayarları yapılmadıysa "Sistem yapılandırılmadı" görürsünüz).
3. Adres çubuğuna `/DEPO-ADI/status` veya `/DEPO-ADI/apply/rehber` yazıp Enter'a basın: 404 ekranı değil, ilgili sayfa açılmalıdır.
4. Tarayıcı geliştirici araçlarında **Network** sekmesinde JS/CSS dosyalarının `200` döndüğünü doğrulayın (URL `/DEPO-ADI/assets/...` biçiminde olmalı).
5. **Settings → Pages** üstünde "Your site is live at ..." mesajını görmelisiniz.

## 7. Güncelleme yayınlama

```bash
git add .
git commit -m "feat(lsc): yeni başvuru sorusu"
git push origin master
```

Yalnızca `LuminacraftStaffCenter/**` veya iş akışı dosyasında değişiklik varsa otomatik yayınlanır. Doküman veya kökteki başka bir klasör değişirse iş akışı tetiklenmez; elle **Run workflow** kullanabilirsiniz. `npm test` başarısız olursa derleme job'u kırmızıya döner ve dağıtım **yapılmaz** — bu bilinçli bir korumadır.

## 8. Sık karşılaşılan hatalar

| Hata | Sebep | Çözüm |
| --- | --- | --- |
| Site boş, JS/CSS `404` | Yanlış `VITE_BASE_PATH` veya depo adı değişti | İş akışındaki `VITE_BASE_PATH` ifadesini kontrol edin; yeniden **Run workflow**. |
| Derleme anında `npm ci` hatası | `package-lock.json` eksik veya `package.json` ile uyumsuz | Lock dosyasını yerelde `npm install` ile güncelleyip commit edin (lock dosyası depoda olmalı). |
| `npm test` kırmızı, yayın yok | Test/göç/public/doküman kontrollerinden biri başarısız | Yerelde `cd LuminacraftStaffCenter && npm test` çalıştırıp ilgili dosyayı düzeltin. |
| Pages run'ı `404: Not Found` veya `Failed to create deployment` | Pages kaynağı "Deploy from a branch" seçili | Settings → Pages → Source: **GitHub Actions** yapın. |
| Derin linkte 404 ekranı | `public/404.html` değiştirilmiş veya kodlama dizeleri index ile uyuşmuyor | İki dosyadaki `?/` / `encodeURIComponent(path)` / `decodeURIComponent(search.slice(1))` dizelerini eşitleyin. |
| `Resource not accessible by integration` | Pages izinleri eksik | İş akışındaki `pages: write` ve `id-token: write` izinlerini koruyun; Actions ayarlarında workflow izinlerini kontrol edin. |
| Ambardaki eski sürüm görünüyor | Tarayıcı önbelleği | Sert yenileme (Ctrl+F5) yapın; dağıtımın timestamps'ini Actions sekmesinden doğrulayın. |
| Kodda gizli anahtar görünüyor | `service_role` `.env` veya iş akışına yazıldı | Anahtarları Supabase Dashboard'dan döndürün (rotate), dosyalardan çıkarın, geçmişi temizleyin. Bkz. [guvenlik.md](guvenlik.md). |
