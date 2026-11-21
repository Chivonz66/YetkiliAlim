# Luminacraft Staff Center

Luminacraft topluluğu için **gerçek** ekip başvurusu, başvuru takibi ve personel yönetimi paneli. Bu depo, yalnızca arayüzü değil; veritabanı göçlerini (migrations), Sunucu Tarafı Edge Functions uçlarını, güvenlik katmanını ve GitHub Pages dağıtım iş akışını da içerir.

> **Önemli:** Uygulama örnek/mock veri içermez. Formlar, sorular, başvurular ve yönetim ekranları gerçek bir Supabase projesine ve dağıtılmış Edge Functions uçlarına bağlanır. Yapılandırma yapılmadan sayfalar açılsa bile veri gelmez; "Demo modu" veya sahte kayıt üreten bir kod yolu yoktur.

## Mimarî (metin diyagramı)

```
                      ┌──────────────────────────────────────┐
                      │  Tarayıcı (React + React Router)     │
                      │  /  /apply/:position  /status /admin │
                      └───────────────┬──────────────────────┘
                                      │ HTTPS (VITE_SUPABASE_URL)
                                      │ apikey: anon, cookie: HttpOnly
                      ┌───────────────▼──────────────────────┐
                      │  Supabase Gateway (/functions/v1/*)  │
                      │   8 Edge Function (Deno)             │
                      │  oturum + CSRF + hız sınırı + doğrulama│
                      └───────────────┬──────────────────────┘
                                      │ service_role (yalnızca Edge içinde)
                      ┌───────────────▼──────────────────────┐
                      │  PostgreSQL (Supabase)               │
                      │  RLS + tablolar + RPC + tetikleyiciler│
                      └──────────────────────────────────────┘

  Dağıtım: git push (master) → GitHub Actions → npm ci / npm test / npm run build
           → GitHub Pages artefaktı → https://KULLANICI.github.io/DEPO-ADI/
```

## Özellikler

- **Başvuru formu:** `rehber` ve `aac` pozisyonları için veritabanından gelen dinamik sorular (7 soru tipi), zorunlu alan ve uzunluk/değer doğrulaması.
- **Başvuru takibi:** Takip numarası + tek kullanımlık gizli sorgu anahtarı ile yalnızca güvenli durum alanları; notlar, puanlar ve iletişim bilgileri asla döndürülmez.
- **Yönetim paneli:** Başvuru listeleme/filtreleme, detay, karar kaydı, kriter bazlı puanlama (ağırlıklar toplamı 100), yönetici notları, soru/pozisyon/ayar yönetimi.
- **Oturum güvenliği:** PBKDF2-SHA256 parola özetleri, imzalı oturum belirteci, `HttpOnly` + `Secure` + `SameSite=None` çerez, çift gönderim CSRF.
- **İstismar önlemleri:** IP bazlı hız sınırı, honeypot alanı, 3 saniyelik asgari doldurma süresi, sunucu tarafı Zod doğrulaması, allowlist CORS.
- **Discord kullanıcı adı:** Zorunlu bir başvuru alanıdır; hesap bağlama/OAuth akışı, bot veya DM bildirimi kullanılmaz.
- **Denetlenebilirlik:** Durum geçişleri geçmiş tablosuna ve salt okunur denetim günlüğüne yazılır.
- **Dağıtım:** Ücretsiz GitHub Pages + GitHub Actions; ücretli domain veya özel barındırma gerekmez.

## Discord kullanıcı adı

Discord kullanıcı adı, başvuru formunda kullanıcının kendisi tarafından yazılan **düz metin** bir alandır. 3–32 karakter uzunluğunda olmalı ve yalnızca harf, rakam, `.` ve `_` içermelidir. Bu alan hem istemcide hem Edge Function ve veritabanı tarafında doğrulanır. Discord hesap bağlama, OAuth, bot, özel mesaj (DM) bildirimi veya buna ait bir ayar yoktur.

## Teknoloji yığını

| Katman | Teknoloji |
| --- | --- |
| Arayüz | React 18, TypeScript, Vite 5, React Router 6, Tailwind CSS, dnd-kit, lucide-react |
| Doğrulama | Zod 3 (Edge çalışma zamanında), saf doğrulama yardımcıları (`_shared/pure.ts`) |
| Veri | Supabase PostgreSQL, RLS, `SECURITY DEFINER` RPC, tetikleyiciler |
| Sunucu | Supabase Edge Functions (Deno), `Deno.serve` |
| Test | Vitest 2 + jsdom (`npm test`) |
| Dağıtım | GitHub Actions + GitHub Pages (`actions/deploy-pages@v4`) |

## Hızlı başlangıç

```bash
cd LuminacraftStaffCenter
npm ci
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
# .env dosyasına GERÇEK Supabase URL ve anon key değerlerinizi yazın
npm run dev                 # http://localhost:5173
npm test                    # tüm birim metin/test kontrolleri
npm run build               # tsc -b && vite build → dist/
```

Ardından **mutlaka** dokuz SQL göçünü (`0001` → `0009`) uygulayın, Edge gizli anahtarlarını tanımlayın, uçları dağıtın ve ilk yöneticiyi CLI ile oluşturun: bkz. [Kurulum](docs/kurulum.md). `0006_decision_notify.sql` artık SQL içermeyen bir yer tutucudur; `0009_remove_discord_integrations.sql` eski Discord/DM veritabanı nesnelerini kaldırır.

## Belgeler

| Belge | İçeriği |
| --- | --- |
| [Kurulum Kılavuzu](docs/kurulum.md) | Supabase projesi, göç sırası, `.env`, ilk yönetici, gizli anahtarlar, Edge dağıtımı, doğrulama ve sorun giderme |
| [GitHub Pages Dağıtımı](docs/github-pages.md) | Pages ayarı, taban yol, iş akışı, SPA 404, yayınlama ve hata durumları |
| [Edge Functions](docs/edge-functions.md) | 8 uç için amaç, eylem, yetkilendirme, istek/yanıt örnekleri, gizli anahtarlar, loglar |
| [Güvenlik Modeli](docs/guvenlik.md) | RLS, service_role ayrımı, PBKDF2, oturum/CSRF, rate limit, denetim, sır yönetimi |

## Ortam değişkenleri

**Tarayıcıya derlenenler (`VITE_` ile başlar; asla sır içermez):**

| Değişken | Nereden alınır | Örnek / varsayılan | Açıklama |
| --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | Supabase → Project Settings → API | `https://sizin-projeniz.supabase.co` | Proje URL'si; tüm Edge çağrıları buraya gider. |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Project Settings → API | `sizin-anon-keyiniz` | Herkese açık anon anahtar; RLS tarafından sınırlandırılır. |
| `VITE_BASE_PATH` | Dağıtım ortamı / iş akışı | `/` (yerel), `/DEPO-ADI/` (Pages) | Vite `base` ayarı; proje sitesi alt dizinleri için gereklidir. |

**Yalnızca Edge Functions ortamında (`supabase secrets set`):**

| Değişken | Zorunlu | Açıklama |
| --- | --- | --- |
| `SUPABASE_URL` | Evet | Sunucu tarafı proje URL'si (`VITE_SUPABASE_URL` yedeği okunur). |
| `SUPABASE_SERVICE_ROLE_KEY` | Evet | Tüm veritabanı yazma işlemleri; **tarayıcıya asla gönderilmez**. |
| `SESSION_SECRET` | Evet | Oturum belirteci HMAC imzası. |
| `ADMIN_SETUP_SECRET` | Edge `setup` kullanılacaksa | `admin-auth` kurulum eylemi için `x-admin-setup-secret` başlığıyla karşılaştırılır; tanımlı değilse eylem kapalıdır. |
| `RATE_LIMIT_SALT` | Önerilir | IP özetleme tuzu; ham IP saklanmaz. |
| `ALLOWED_ORIGINS` | Üretimde evet | Virgülle ayrılmış izinli origin listesi (CORS). |

**İlk yönetici CLI'si için (komut satırında geçici):**
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` (en az 12 karakter).

## Dağıtım özeti

`.github/workflows/deploy-luminacraft-staff-center.yml` yalnızca `master` dalına `LuminacraftStaffCenter/**` veya iş akışının kendisinde değişiklik olduğunda çalışır (ayrıca elle tetiklenebilir). Job düzeyinde `VITE_BASE_PATH: /${{ github.event.repository.name }}/` ayarlanır; `npm ci → npm test → npm run build → 404.html → configure-pages → upload-pages-artifact → deploy-pages` sırası izlenir. Pages **Source: GitHub Actions** olmalıdır; ücretli domain gerekmez. Ayrıntılar: [github-pages.md](docs/github-pages.md).

## Bilinen sınırlamalar ve dış gereksinimler

1. **Supabase projesi şarttır.** Tablo, RLS, RPC veya Edge uçları olmadan uygulama çalışmaz; mock veri yoktur.
2. **Discord hesap bağlama/OAuth/DM kullanılmaz.** Discord kullanıcı adı zorunlu bir form alanıdır (3–32 karakter; harf/rakam/`.`/`_`); doğrulama sunucu tarafında yapılır.
3. **İlk yönetici CLI ile oluşturulmalıdır.** Göçlerden sonra `node scripts/create-first-admin.mjs` komutu çalıştırılmazsa giriş yapılamaz.
4. **GitHub Pages, GitHub Actions kaynağıyla etkinleştirilmelidir.** Aksi halde iş akışı artefaktı yayınlanamaz.
5. **Supabase Gateway ve CORS:** Uçlar özel oturum çerezi kullandığı için `--no-verify-jwt` ile dağıtılmalı; `ALLOWED_ORIGINS` üretim adresini içermelidir.
6. **Başvuru hız sınırı atomiktir** (`increment_rate_limit(...)` RPC'si); giriş kilidi (`admin-auth`) ise okuma-yazma döngüsü kullandığından çok yüksek eşzamanlılıkta birkaç deneme eşiği aşabilir.
7. **İlk yönetici kurulumu:** `admin-auth` uçundaki `setup` eylemi yalnızca `admins` tablosu boşken **ve** geçerli `x-admin-setup-secret` başlığı gönderildiğinde çalışır. Önerilen yol CLI'dir; detaylar [güvenlik belgesinde](docs/guvenlik.md) anlatılmıştır.
