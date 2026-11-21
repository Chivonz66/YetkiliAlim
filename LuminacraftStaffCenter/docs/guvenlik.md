# Güvenlik Modeli

Bu belge, Luminacraft Staff Center'ın gerçekten uyguladığı korumaları ve sorumluluk sınırlarını açıklar. Varsayımlar veya "gelecekte eklenecek" özellikler gerçek gibi sunulmaz.

## 1. Veritabanı erişimi ve RLS

- Tüm uygulama tablolarında **Row Level Security (RLS)** etkindir (`0002_rls_policies.sql`). Varsayılan davranış reddetmedir.
- `anon` ve `authenticated` rolleri yalnızca **etkin** `positions`, `question_categories`, `questions`, `question_options`, `score_criteria` kayıtlarını `SELECT` edebilir. Bu tablolara yazma izni `REVOKE ALL` ile kaldırılmıştır.
- Başvuru, cevap, puan, yönetici notu, geçmiş, yönetici/oturum kayıtları, `app_settings`, `rate_limits` ve `audit_logs` için `anon`/`authenticated` rollerine açıkça `USING (false) WITH CHECK (false)` ilkeleri tanımlıdır. Eski Discord/DM nesneleri `0009_remove_discord_integrations.sql` ile kaldırılmıştır.
- Herkese açık okuma iki `SECURITY DEFINER` RPC ile sınırlıdır:
  - `get_public_questions(position_slug)`: yalnızca etkin soruları ve seçeneklerini döner.
  - `lookup_application(tracking_no, query_token)`: takip numarası **ve** sorgu anahtarının SHA-256 özeti eşleşirse yalnızca güvenli durum alanlarını döner.
- İki fonksiyonda da `search_path = public, pg_temp` ayarlıdır; `PUBLIC` rolünden tüm haklar geri alınıp yalnızca `anon`/`authenticated`'a `EXECUTE` verilir.

## 2. service_role ayrımı

- `SUPABASE_SERVICE_ROLE_KEY` yalnızca Supabase Edge Functions ortamındadır (`_shared/db.ts`); hiçbir yanıta, tarayıcı paketine, `.env` dosyasına veya GitHub Actions dosyasına eklenmez.
- Tüm yazma/güncelleme/silme işlemleri bu sunucu istemcisiyle yapılır; tarayıcıdan gelen istek doğrudan korumalı tabloya yazamaz.
- RLS'yi atlayan bu anahtarın gücü nedeniyle dağıtımda **yalnızca Edge secret'ı** olarak tutulur; CLI (`create-first-admin.mjs`) da anahtarı yalnızca çalışma anında ortam değişkeninden okur, diske yazmaz.
- `admin-auth` ucundaki `setup` eylemi **ikili kapı** ile korunur: `admins` tablosu boş OLMALI **ve** istekte geçerli `x-admin-setup-secret` başlığı bulunmalıdır (Edge secret: `ADMIN_SETUP_SECRET`). Secret tanımlı değilse eylem `403 forbidden` döner; ilk yöneticiyi rastgele bir istekten oluşturma penceresi kapanır. Önerilen kurulum yolu CLI'dir.

## 3. Parolalar: PBKDF2-SHA256

- Biçim: `pbkdf2$210000$<saltHex>$<hashHex>`; **210.000 yineleme**, **16 bayt tuz**, **32 bayt anahtar**, SHA-256.
- İlk yönetici CLI'si (`scripts/create-first-admin.mjs`) ve Edge `hashPassword` aynı parametreleri kullanır; ham parola diske, günlüğe veya yanıta yazılmaz.
- Doğrulama Web Crypto `deriveBits` ile yapılır ve `timingSafeEqualHex` ile sabit zamanlı karşılaştırılır. Özet biçimi bozuksa doğrulama `false` döner.
- Kullanıcı adı: 3–32 karakter, yalnızca harf/rakam/`.`/`_`/`-`; veritabanında `lower(username)` üzerinde tekil indeks vardır. Parola en az 12 karakter zorunludur.
- Mevcut yöneticiyi değiştirmek için CLI'da `ALLOW_REPLACE_ADMIN=1` **ve** `SETUP_TOKEN` onay ifadesi birlikte gerekir (kimlik bilgisi değil, yazılı onay). Edge `setup` eylemi için ayrıca `ADMIN_SETUP_SECRET` zorunludur.

## 4. Oturum ve çerezler

- `admin-auth/login` başarılı olunca `SESSION_SECRET` ile HMAC-SHA256 imzalı bir oturum belirteci üretilir (payload: `sub`, `exp`, 16 bayt `nonce`).
- Doğrulama: imza sabit zamanlı karşılaştırılır, `exp` kontrol edilir, yönetici kaydı veritabanından okunup `is_active` durumu doğrulanır. Süre **8 saat** (`SESSION_MAX_AGE = 28800`).
- Çerez ayarları: `lsc_admin_session=...; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=28800`. `HttpOnly` JavaScript erişimini engeller; `Secure` yalnızca HTTPS; `SameSite=None` Supabase alt alanı/Pages kombinasyonlarında çerezin gönderilmesini sağlar (CSRF koruması ayrıca vardır).
- `lsc_csrf` çerezi JavaScript tarafından okunabilir olacak şekilde kurulur (`Secure; SameSite=None`), ancak `HttpOnly` değildir — çift gönderim deseninin gereği budur.
- `logout` çerezleri `Max-Age=0` ile temizler. `admin_sessions` tablosu oturumların ham değil **özetini** tutar; `cleanup_expired_sessions()` ile eski kayıtlar silinebilir.

## 5. CSRF (çift gönderim)

- GET dışındaki tüm yönetici isteklerinde `requireAdmin(req, { csrf: true })` çalışır.
- İstemci, `lsc_csrf` çerezindeki değeri `x-csrf-token` başlığında geri gönderir; sunucu iki değeri sabit zamanlı karşılaştırır (`timingSafeEqualHex`).
- Eşleşmezse `403 csrf` döner ve işlem yapılmaz. Origin allowlist'i (`ALLOWED_ORIGINS`) de CORS düzeyinde joker kullanmadan uygulanır.
- Yönetici oturumu olmayan istekler `401`, yapılandırma eksikliği `503 configuration` ile reddedilir.

## 6. Başvuru spam ve kötüye kullanım önlemleri

- **Hız sınırı:** IP başına saatlik pencere; varsayılan `rate_limit_per_ip_per_hour = 5` (`app_settings`). IP ham olarak saklanmaz; `RATE_LIMIT_SALT` ile `sha256(salt:ip)` özeti kullanılır (`source_ip_hash` / `rate_limits.key`).
- **Honeypot:** Formdaki `website` alanı kullanıcıya görünmez olmalı; doldurulursa `400 honeypot` döner.
- **Zaman eşiği:** `elapsed_ms >= 3000`; çok hızlı gönderimler `429 too_fast` ile reddedilir. Botların formu saniyeler içinde doldurması engellenir.
- **Sunucu tarafı doğrulama:** Zod şemaları alan uzunluklarını, Minecraft/Discord kullanıcı adı desenlerini, yaş (**16–99**) ve saat (0–24) aralıklarını, cevap tiplerini zorunlu kılar. Soru metinleri ve seçenekler istemciden değil veritabanından okunur. Seçenek listesi boşsa seçim tipi cevaplar reddedilir.
- **Hız sınırı güncellemesi:** Başvuru tarafı `0005_submit_atomic.sql` içindeki `increment_rate_limit(...)` RPC'siyle atomiktir (`INSERT ... ON CONFLICT ... RETURNING`). Giriş kilidi (`admin-auth`) hâlâ okuma-yazma döngüsü kullandığından çok yüksek eşzamanlılıkta birkaç deneme eşiği aşabilir; logları izlemek önerilir.

## 7. XSS ve SQL enjeksiyonu

- React, JSX içinde metinleri varsayılan olarak kaçırır; kodda `dangerouslySetInnerHTML`, `innerHTML` veya `eval` kullanılmaz. Başvuru cevapları ham HTML olarak basılmaz.
- Zod şemaları tüm metin alanlarında üst sınır koyar (örn. cevap 4000 karakter, not 2000 karakter, istek gövdesi toplam 1.000.000 karakter).
- SQL doğrudan birleştirilmez: erişim PostgREST/Supabase istemcisi ve parametreli `SECURITY DEFINER` RPC'leriyle yapılır. `admin-applications` arama alanındaki `,()%\\` karakterleri temizlenir ve değer 100 karakterle sınırlıdır (PostgREST filtre enjeksiyonu önlemi).
- Hata yanıtları geneldir; yığın izi, SQL metni veya iç sunucu ayrıntıları döndürülmez (`_shared/responses.ts`).

## 8. Sırların saklanması, sorgu anahtarı ve denetim

- **Sorgu anahtarı (query token):** Başvuru oluşturulurken 32 rastgele bayt üretilir; yalnızca `submit-application` yanıtında bir kez gösterilir. Veritabanında `query_token_hash` olarak 64 karakterli SHA-256 özeti tutulur; ham anahtar saklanmaz. Kaybolan anahtar geri getirilemez.
- **Yönetici notları:** `application_notes` tablosunda tutulur; RLS ile anon/authenticated'a kapalıdır, `public-status` yanıtında yer almaz ve herkese açık hiçbir sorguda döndürülmez.
- **Denetim:** Durum değişiklikleri tetikleyici ile `application_history` ve **salt okunur** `audit_logs` tablosuna yazılır; `0003_functions_triggers.sql` içindeki tetikleyici güncelleme/silme/kırpma işlemlerini hata ile reddeder. Yönetici eylemleri ayrıca `writeAudit` yardımcısıyla kaydedilir.
- **Bilinen sınır:** Bazı yönetici eylemlerinde `writeAudit` yardımcısı tetikleyici kayıtlarından farklı kolom adları kullanır; denetim incelemesinde hem tablo kayıtlarını hem uç loglarını birlikte değerlendirin.

## Discord kullanıcı adı

Discord kullanıcı adı başvurunun zorunlu bir alanıdır: kullanıcı tarafından forma yazılan düz metindir, 3–32 karakter olmalı ve yalnızca harf, rakam, `.` ve `_` içermelidir. Zod şeması ve veritabanı kısıtı bu deseni zorunlu kılar. Discord hesap bağlama/OAuth akışı, bot veya DM bildirimi yoktur; erişim belirteci ya da bağlantı belirteci üretilmez, saklanmaz veya loglanmaz.

## 9. Sır döndürme (rotation)

1. **SESSION_SECRET:** Yeni uzun rastgele değeri `supabase secrets set SESSION_SECRET=...` ile tanımlayın; oturum belirtecinin imzası değişeceği için tüm yöneticilerin yeniden giriş yapması gerekir.
2. **SUPABASE_SERVICE_ROLE_KEY:** Supabase Dashboard'da yeni anahtar oluşturun, `supabase secrets set` ile güncelleyin ve ilgili uçları yeniden dağıtın.
3. **RATE_LIMIT_SALT:** Değiştirmek mevcut IP özetlerini geçersiz kılar (hız sınırı penceresi sıfırlanır); trafik yoğun olmayan bir zamanda yapın.
4. Değişiklikten sonra `supabase functions list` ve uç loglarını kontrol edin; `configuration` hatası secret adı yazım hatasına işaret eder.

## 10. Depoda BULUNMAYAN değerler

Aşağıdakiler bu depoda, `.env.example` içinde, iş akışında veya dokümanlarda **gerçek değeriyle** yer almaz — yalnızca placeholder adları geçer:

- `SUPABASE_SERVICE_ROLE_KEY`, gerçek anon key veya JWT belirteci
- `SESSION_SECRET`, `RATE_LIMIT_SALT`, `ADMIN_SETUP_SECRET`
- Yönetici kullanıcı adı/parolası, başvuranların e-posta/adres bilgileri
- Ham sorgu anahtarı, oturum belirteci, CSRF değeri

`.env.example` yalnızca `https://sizin-projeniz.supabase.co`, `sizin-anon-keyiniz` ve `/` gibi yer tutucular içerir. Gerçek değerler yerel `.env` (git tarafından yok sayılır) veya Supabase Edge Secrets ortamındadır. Bir sır yanlışlıkla commit edilirse önce **döndürün**, sonra dosyayı düzeltin ve geçmişi temizleyin; sırrı silmek tek başına yeterli değildir.

İlgili işlemler: [kurulum.md](kurulum.md), [edge-functions.md](edge-functions.md).
