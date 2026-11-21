# Kurulum Kılavuzu (Supabase + Edge Functions + Yerel Geliştirme)

Bu kılavuz, Luminacraft Staff Center'ı **sıfırdan çalışır hale getirmek** için gereken adımları içerir. Uygulama mock veri kullanmaz: Supabase projesi, göçler, Edge Functions ve ilk yönetici olmadan hiçbir ekran gerçek veri göstermez.

Toplam süre: yaklaşık 20–30 dakika. Gereksinimler: Node.js 20+, npm, bir Supabase hesabı ve (Edge dağıtımı için) Supabase CLI.

---

## 1. Supabase projesi oluşturma

1. [supabase.com](https://supabase.com) → **New project**.
2. Organization, proje adı (örn. `luminacraft-staff`), güçlü bir veritabanı parolası ve bölge seçin. Parolayı kaydedin; ileride `psql` ile göç uygulayacaksanız gerekecek.
3. Proje hazır olunca **Project Settings → API** ekranından şunları kopyalayın:
   - **Project URL** → `VITE_SUPABASE_URL` / Edge `SUPABASE_URL`
   - **anon public** anahtarı → `VITE_SUPABASE_ANON_KEY` (tarayıcıya derlenir, RLS ile sınırlandırılır)
   - **service_role** anahtarı → yalnızca Edge Functions ve CLI içinde kullanılır; **asla** `.env` dosyasına veya istemci koduna yazmayın, GitHub'a yüklemeyin.
4. **Project Settings → API → JWT Settings / Project API keys** alanında `service_role` anahtarının "secret" olduğunu doğrulayın. Bu anahtar RLS'yi atlar.

## 2. Migrations dosyalarını sırayla uygula

Dokuz SQL dosyası `LuminacraftStaffCenter/supabase/migrations/` altındadır. **Sıra önemlidir**; şema → RLS → fonksiyon/tetikleyici → tohum veri → atomik başvuru → yer tutucu göç → canlı uzlaştırma → pozisyon ayarı izni → eski Discord/DM nesnelerinin kaldırılması.

| Sıra | Dosya | Ne yapar |
| --- | --- | --- |
| 1 | `0001_initial_schema.sql` | `pgcrypto` uzantısı, tablolar (`positions`, `questions`, `applications`, `admins`, `admin_sessions`, `app_settings`, `rate_limits`, `audit_logs` vb.), indeksler, yaş 16–99 denetimi ve `create_first_admin` RPC'si. |
| 2 | `0002_rls_policies.sql` | Tüm tablolar için RLS; anon'a yalnızca etkin soru/pozisyon/kategori/ölçüt okuma; `lookup_application` ve `get_public_questions` RPC'leri. |
| 3 | `0003_functions_triggers.sql` | `updated_at`, takip numarası, durum geçişi geçmişi, salt okunur denetim günlüğü, puan bütünlüğü, temizleme fonksiyonları ve `apply_application_decision` RPC'si. |
| 4 | `0004_seed_data.sql` | 2 pozisyon, 5 kategori, 6 puan ölçütü (ağırlık toplamı 100), 13 soru, seçenekler ve varsayılan `app_settings` (yaş sorusu 16–99). |
| 5 | `0005_submit_atomic.sql` | `submit_application_atomic(...)` ve atomik `increment_rate_limit(...)` RPC'leri. |
| 6 | `0006_decision_notify.sql` | Artık çalıştırılacak SQL içermeyen **yer tutucu** göç; göç sırasının bozulmaması için korunur. |
| 7 | `0007_live_reconciliation.sql` | İlk dağıtımdan sonra düzenlenen 0001/0003/0004 değişikliklerini zaten uygulanmış veritabanına ileriye dönük olarak taşır. |
| 8 | `0008_public_position_settings.sql` | `${slug}_applications_open` ayarlarının herkese açık okunmasını sağlayan RLS politikası. |
| 9 | `0009_remove_discord_integrations.sql` | Eski Discord hesap bağlama ve DM bildirim nesnelerini (tablolar, sütunlar, RPC'ler ve ayar) kaldırır; zorunlu Discord kullanıcı adı alanını 3–32 karakter kuralıyla korur. Mevcut veritabanında tek başına da uygulanabilir. |

**Yöntem A — Supabase SQL Editor (önerilen):**

1. Supabase Dashboard → **SQL Editor → New query**.
2. `0001_initial_schema.sql` içeriğini yapıştırın → **Run**. "Success" görmeden sonraki dosyaya geçmeyin.
3. Aynı işlemi `0002`, `0003`, `0004`, `0005`, `0006`, `0007`, `0008`, `0009` için sırayla yapın. `0006` yer tutucudur, hatasız çalışır.
4. Tohum veri (`0004`) `ON CONFLICT DO NOTHING` kullanır; dosyayı birden fazla kez çalıştırmak veri çoğaltmaz. `0007`, mevcut yaş sorusunu 16–99 olarak günceller. `0009` tekrar çalıştırılabilir (idempotent).

**Yöntem B — psql (yerel/CLI):**

```bash
export DATABASE_URL='postgresql://postgres:<DB-PAROLASI>@<HOST>:6543/postgres'
psql "$DATABASE_URL" -f supabase/migrations/0001_initial_schema.sql
psql "$DATABASE_URL" -f supabase/migrations/0002_rls_policies.sql
psql "$DATABASE_URL" -f supabase/migrations/0003_functions_triggers.sql
psql "$DATABASE_URL" -f supabase/migrations/0004_seed_data.sql
psql "$DATABASE_URL" -f supabase/migrations/0005_submit_atomic.sql
psql "$DATABASE_URL" -f supabase/migrations/0006_decision_notify.sql
psql "$DATABASE_URL" -f supabase/migrations/0007_live_reconciliation.sql
psql "$DATABASE_URL" -f supabase/migrations/0008_public_position_settings.sql
psql "$DATABASE_URL" -f supabase/migrations/0009_remove_discord_integrations.sql
```

> Bu dosyalar Supabase CLI'nin zaman damgalı göç adlandırmasını kullanmaz; bu yüzden `supabase db push` yerine yukarıdaki sıralı yöntemlerden birini kullanın.

**Göç sonrası hızlı kontrol (SQL Editor):**

```sql
select count(*) as pozisyon from public.positions;        -- 2 olmalı
select count(*) as soru from public.questions;            -- 13 olmalı
select sum(weight) as agirlik from public.score_criteria; -- 100 olmalı
select count(*) as ayar from public.app_settings;         -- 6 olmalı
```

## 3. `.env` dosyasını oluştur

```bash
cd LuminacraftStaffCenter
cp .env.example .env          # PowerShell: Copy-Item .env.example .env
```

`.env` içeriği (değerlerin yerine kendi gerçek değerlerinizi yazın):

```dotenv
VITE_SUPABASE_URL=https://sizin-projeniz.supabase.co
VITE_SUPABASE_ANON_KEY=sizin-anon-keyiniz
VITE_BASE_PATH=/
```

- Yerel geliştirmede `VITE_BASE_PATH=/` kalabilir. GitHub Pages iş akışı bunu otomatik olarak `/DEPO-ADI/` yapar; elle değiştirmeyin.
- `.env` dosyası `.gitignore` ile kapsanır. İçine `service_role`, parola veya başka bir sır **koymayın**; `VITE_` ön eki bu değerleri tarayıcı paketine gömer.
- Değişiklikten sonra dev sunucusunu yeniden başlatın.

## 4. İlk yöneticiyi oluştur (zorunlu)

Arayüzde oturum açabilmek için en az bir yönetici kaydı gerekir. CLI, parolayı PBKDF2-SHA256 (210.000 yineleme, 16 bayt tuz, 32 bayt anahtar) ile özetleyip yalnızca özeti veritabanına yazar; ham parola diske veya loglara gitmez.

```bash
SUPABASE_URL=https://sizin-projeniz.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<sizin-service-role-anahtariniz> \
ADMIN_USERNAME=<yonetici-kullanici-adi> \
ADMIN_PASSWORD=<en-az-12-karakterli-parola> \
node scripts/create-first-admin.mjs
```

PowerShell (tek satırda):

```powershell
$env:SUPABASE_URL='https://sizin-projeniz.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY='<sizin-service-role-anahtariniz>'
$env:ADMIN_USERNAME='<yonetici-kullanici-adi>'
$env:ADMIN_PASSWORD='<en-az-12-karakterli-parola>'
node scripts/create-first-admin.mjs
```

Kurallar: `ADMIN_USERNAME` 3–32 karakter, yalnızca harf/rakam/`.`/`_`/`-`; `ADMIN_PASSWORD` en az 12 karakter. Araç zaten bir yönetici varsa işlemi reddeder. Bilinçli değiştirme gerekiyorsa:

```bash
ALLOW_REPLACE_ADMIN=1 SETUP_TOKEN=LUMINACRAFT-ADMIN-REPLACE-ONAY \
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
ADMIN_USERNAME=... ADMIN_PASSWORD=... \
node scripts/create-first-admin.mjs
```

`SETUP_TOKEN` bir kimlik bilgisi değil, bu dokümanda yer alan yazılı onay ifadesidir. Komut başarılı olduğunda `Tamamlandı: İlk yönetici başarıyla oluşturuldu.` mesajını görürsünüz.

> `admin-auth` ucundaki `setup` eylemi yalnızca `admins` tablosu boşken **ve** geçerli `x-admin-setup-secret` başlığı gönderildiğinde çalışır. Edge tarafında `ADMIN_SETUP_SECRET` tanımlı değilse bu eylem `403 forbidden` döner; önerilen kurulum yolu yukarıdaki CLI'dır. Ayrıntı: [guvenlik.md](guvenlik.md).

## 5. Edge Functions gizli anahtarlarını tanımla

Kodda gerçekten okunan değişkenler bunlardır (`_shared/db.ts`, `_shared/auth.ts`, `_shared/pure.ts`, uç dosyaları):

| Değişken | Zorunluluk | Kullanım yeri / amaç |
| --- | --- | --- |
| `SUPABASE_URL` | Evet | Tüm uçlarda veritabanı istemcisi (`VITE_SUPABASE_URL` yedek). |
| `SUPABASE_SERVICE_ROLE_KEY` | Evet | Tüm uçlarda yazma/silinme işlemleri; yalnızca sunucu. |
| `SESSION_SECRET` | Evet | `admin-auth` oturum imzası (HMAC-SHA256). Uzun rastgele bir değer kullanın. |
| `ADMIN_SETUP_SECRET` | Edge `setup` kullanılacaksa | `admin-auth` kurulum eyleminin `x-admin-setup-secret` başlığıyla karşılaştırdığı değer. Tanımlı değilse `setup` kapalıdır; CLI kurulumundan sonra gerekmez. |
| `RATE_LIMIT_SALT` | Önerilir | `submit-application` IP özetleme tuzu; ham IP saklanmaz. |
| `ALLOWED_ORIGINS` | Üretimde evet | `_shared/cors.ts` allowlist'i. Örn. `https://KULLANICI.github.io,http://localhost:5173`. |

Örnek (değerler placeholder'dır):

```bash
supabase login
supabase link --project-ref <PROJE-REFERANSI>
supabase secrets set \
  SUPABASE_URL=https://sizin-projeniz.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=<servis-anahtari> \
  SESSION_SECRET=<uzun-rastgele-deger> \
  ADMIN_SETUP_SECRET=<edge-kurulum-ici-rastgele-deger> \
  RATE_LIMIT_SALT=<baska-bir-rastgele-deger> \
  ALLOWED_ORIGINS=https://KULLANICI.github.io,http://localhost:5173
```

Discord kullanıcı adı düz metin bir başvuru alanı olduğu için Discord'a ait ek bir gizli anahtar yoktur. `supabase secrets list` yalnızca anahtar adlarını gösterir; değerleri göstermez. Gizli anahtarları bir kez daha görmeniz gerekirse Supabase Dashboard → Project Settings → Edge Functions → Secrets kullanın.

## 6. Edge Functions uçlarını dağıt

Sekiz uç vardır; hepsi özel oturum çerezi kullandığı için `--no-verify-jwt` ile dağıtılır (kimlik doğrulama fonksiyonun içinde yapılır).

```bash
for fn in admin-auth admin-applications admin-questions admin-positions \
          admin-scores admin-settings public-status submit-application; do
  supabase functions deploy "$fn" --no-verify-jwt
done
```

Windows PowerShell:

```powershell
$ucLar = @('admin-auth','admin-applications','admin-questions','admin-positions',
           'admin-scores','admin-settings','public-status','submit-application')
foreach ($uc in $ucLar) { supabase functions deploy $uc --no-verify-jwt }
```

Her uç için amaç, eylem adları, istek/yanıt örnekleri ve log ipuçları: [edge-functions.md](edge-functions.md).

## 7. Discord kullanıcı adı

Discord kullanıcı adı başvuru formunun **zorunlu** alanıdır. Kullanıcı adını kendisi yazar; 3–32 karakter olmalı ve yalnızca harf, rakam, `.` ve `_` içermelidir. Değer hem istemcide hem Edge Function'da ve veritabanı kısıtında doğrulanır. Discord hesap bağlama, OAuth, bot, DM bildirimi veya buna ait bir ayar kullanılmaz; bu alan için ayrı bir kurulum gerekmez.

## 8. Yerelde çalıştır

```bash
npm ci
npm run dev        # http://localhost:5173
```

Diğer komutlar:

```bash
npm test           # Vitest: saf yardımcılar, SQL/Edge/public/docs kontrolleri
npm run typecheck  # TypeScript denetimi
npm run build      # tsc -b && vite build → dist/
```

## 9. Doğrulama kontrol listesi

- [ ] SQL Editor'da dokuz göç dosyası hatasız uygulandı (`0006` yer tutucudur, `0009` eski Discord/DM nesnelerini kaldırdı); `positions=2`, `questions=13`, ölçüt ağırlık toplamı `100`, yaş sorusu `16–99`.
- [ ] `create_first_admin`, `apply_application_decision`, `submit_application_atomic`, `increment_rate_limit` RPC'leri `service_role` için çalıştırılabiliyor.
- [ ] `.env` gerçek proje URL/anon anahtarını içeriyor, `service_role` içermiyor.
- [ ] `node scripts/create-first-admin.mjs` başarılı; `admins` tablosunda 1 kayıt var.
- [ ] `supabase secrets list` gerekli anahtar adlarını gösteriyor.
- [ ] 8 uç `--no-verify-jwt` ile dağıtıldı; Dashboard → Edge Functions → Logs'ta hata yok.
- [ ] `/apply/rehber` sayfası veritabanından gelen soruları gösteriyor.
- [ ] Başvuru formundaki Discord kullanıcı adı zorunlu; 3–32 karakter ve harf/rakam/`.`/`_` dışındaki karakterler reddediliyor.
- [ ] Form gönderildiğinde `tracking_no` ve `query_token` dönyor; `/status` ile durum sorgulanabiliyor.
- [ ] `/admin` adresinde CLI'da belirlediğiniz kullanıcı adı/parola ile giriş yapılabiliyor.
- [ ] Yönetim panelinden bir soru/ayar değiştirilip kaydedildiğinde değişiklik geri okunuyor.
- [ ] `npm test` yeşil.

## Sorun giderme

| Belirti | Olası sebep | Çözüm |
| --- | --- | --- |
| `Sistem yapılandırılmadı` mesajı, boş soru listesi | `.env` eksik/yanlış veya dev sunucusu yeniden başlatılmadı | `.env` değerlerini kontrol edip `npm run dev` yeniden başlatın. |
| Edge yanıtı `configuration` (503) | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` tanımlı değil | `supabase secrets set` ile yeniden ayarlayıp uçları yeniden dağıtın. |
| Girişte `Oturum sistemi yapılandırılmamış` | `SESSION_SECRET` yok | Edge secret olarak ekleyin; oturum çerezi eskisi geçersiz olur, tekrar giriş yapın. |
| Başvuru `429 too_fast` | Form 3 saniyeden kısa sürede gönderildi | Formu dikkatlice doldurup tekrar deneyin; bu bir hata değil, bot önlemidir. |
| Başvuru `429 rate_limit` | IP başına saatlik sınır (varsayılan 5) doldu | Bir saat bekleyin veya `app_settings.rate_limit_per_ip_per_hour` değerini yönetim panelinden güncelleyin. |
| Discord kullanıcı adı reddedildi | 3–32 karakter kuralı veya izin verilmeyen karakter | Yalnızca harf, rakam, `.` ve `_` kullanın. |
| CORS hatası (tarayıcı konsolunda) | `ALLOWED_ORIGINS` üretim adresini içermiyor | Origin'i virgülle ayrılmış listeye ekleyip uçları yeniden dağıtın; joker `*` kullanmayın. |
| `İlk yönetici zaten oluşturulmuş` | `admins` tablosu dolu | Mevcut hesapla giriş yapın; değiştirme gerekiyorsa CLI'daki onay ifadesiyle `ALLOW_REPLACE_ADMIN=1` kullanın. |
| `42703 / PGRST204` kolom hatası | Göç sırası atlandı veya şema sürümü eski | 0001→0009 sırasıyla yeniden uygulayın; mevcut veritabanında `0009` tek başına da uzlaştırma yapar. |
| GitHub Pages 404 / boş sayfa | `VITE_BASE_PATH` yanlış veya Pages kaynağı yanlış | [github-pages.md](github-pages.md) belgesindeki dağıtım kontrol listesini izleyin. |
