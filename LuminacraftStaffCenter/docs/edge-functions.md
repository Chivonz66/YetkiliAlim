# Edge Functions (8 Uç)

Tüm uçlar Deno çalışma zamanında `Deno.serve` ile çalışır, `OPTIONS` isteklerine `204` döner ve yalnızca `ALLOWED_ORIGINS` içindeki originlere CORS izni verir. Yanıtlar `Cache-Control: no-store` taşır; yığın izi veya iç veritabanı hatası istemciye sızmaz.

Adresler: `<SUPABASE_URL>/functions/v1/<uc-adı>` (istemci tarafında `src/lib/constants.ts → API_ENDPOINTS`).

## Ortak yetkilendirme kuralları

| Uç | Oturum | CSRF | Rule |
| --- | --- | --- | --- |
| `admin-auth` | `verify`/`logout` için evet | yalnızca `logout` | `login`, `setup`, `setup-status` oturumsuzdur; `setup` yalnızca `admins` boşken **ve** geçerli `x-admin-setup-secret` başlığı varsa çalışır. |
| `admin-applications`, `admin-questions`, `admin-positions`, `admin-scores`, `admin-settings` | Evet (`requireAdmin`) | GET dışındaki tüm isteklerde | Çerez `lsc_admin_session`, başlık `x-csrf-token` = `lsc_csrf` çerezi. |
| `public-status`, `submit-application` | Hayır (herkese açık) | Yok | Hız sınırı + doğrulama + honeypot; RLS ve RPC ile koruma. |

Yönetici istekleri için örnek başlıklar (değerler placeholder'dır):

```http
Cookie: lsc_admin_session=<IMZALI-OTURUM-BELIRGECI>; lsc_csrf=<CSRF-DEGERI>
x-csrf-token: <CSRF-DEGERI>
Content-Type: application/json
```

Oturum belirteci `SESSION_SECRET` ile HMAC-SHA256 imzalanır, 8 saat (`28800` sn) geçerlidir ve yalnızca `HttpOnly; Secure; SameSite=None` çerezinde taşınır.

---

## 1. `admin-auth` — giriş, oturum doğrulama, ilk yönetici durumu

**Amaç:** Yönetici girişi, oturum sorgulama, çıkış ve kurulum durumunu bildirme.
**Eylemler:** `setup-status`, `login` (POST varsayılan), `setup`, `verify` (GET varsayılan), `logout`.
**Yetki:** `verify` aktif oturum ister; `logout` oturum + CSRF ister.

```bash
# Kurulum gerekli mi?
curl -X POST "<SUPABASE_URL>/functions/v1/admin-auth" \
  -H 'Content-Type: application/json' -d '{"action":"setup-status"}'
# 200 {"ok":true,"has_admin":true,"setup_required":false}

# İlk yöneticiyi Edge üzerinden oluşturma (yalnızca boş admins + doğru secret)
curl -X POST "<SUPABASE_URL>/functions/v1/admin-auth" \
  -H 'Content-Type: application/json' -H 'x-admin-setup-secret: <ADMIN-SETUP-SECRET>' \
  -d '{"action":"setup","username":"<YONETICI-ADI>","password":"<EN-AZ-12-KARAKTER>"}'
# 403 {"ok":false,"error":"Kurulum izni yok.","code":"forbidden"}  (secret yoksa/yanlışsa)

# Giriş (başarılı yanıt iki Set-Cookie başlığı döner)
curl -X POST "<SUPABASE_URL>/functions/v1/admin-auth" \
  -H 'Content-Type: application/json' \
  -d '{"action":"login","username":"<YONETICI-ADI>","password":"<PAROLA>"}'
# 200 {"ok":true,"csrf_token":"<CSRF-DEGERI>","admin":{"username":"<YONETICI-ADI>"}}
# Set-Cookie: lsc_admin_session=...; HttpOnly; Secure; SameSite=None
# Set-Cookie: lsc_csrf=...; Secure; SameSite=None

# Oturum doğrulama
curl "<SUPABASE_URL>/functions/v1/admin-auth" -H 'Cookie: lsc_admin_session=<OTURUM>'
# 200 {"ok":true,"admin":{"username":"<YONETICI-ADI>"},"csrf_token":"<CSRF-DEGERI>"}

# Çıkış
curl -X POST "<SUPABASE_URL>/functions/v1/admin-auth" \
  -H 'Cookie: lsc_admin_session=<OTURUM>; lsc_csrf=<CSRF-DEGERI>' \
  -H 'x-csrf-token: <CSRF-DEGERI>' -d '{"action":"logout"}'
# 200 {"ok":true}
```

Hatalı kimlik bilgisi `401 invalid_credentials`, CSRF uyuşmazlığı `403 csrf`, kurulum secret'ı yoksa/yanlışsa `403 forbidden`, `SESSION_SECRET` yoksa `503 configuration` döner. Parola doğrulaması PBKDF2-SHA256 (210.000 tur) ve sabit zamanlı karşılaştırmadır. login, IP+kullanıcı adı bazlı 5 başarısız deneme / 15 dakika kilidi uygular; yanıt yine genel `invalid_credentials` olur.

## 2. `admin-applications` — başvuru listesi, detay, karar

**Amaç:** Başvuruları filtreleyip listelemek, detay/cevap/puan/not/geçmiş okumak ve karar kaydetmek.
**Eylemler:** `GET` (sorgu parametreleri: `id`, `status`, `position`/`position_slug`, `search`, `limit` ≤ 200, `offset`), `PATCH` (gövde: `id`, `status`, `note?`).
**Yetki:** oturum + CSRF (PATCH). `accepted`/`rejected` kararı durum geçişi geçmişine yazılır.

```bash
curl "<SUPABASE_URL>/functions/v1/admin-applications?status=pending&limit=50" \
  -H 'Cookie: lsc_admin_session=<OTURUM>' -H 'x-csrf-token: <CSRF-DEGERI>'
# 200 {"ok":true,"applications":[...],"total":1,"limit":50,"offset":0}

curl -X PATCH "<SUPABASE_URL>/functions/v1/admin-applications" \
  -H 'Cookie: lsc_admin_session=<OTURUM>; lsc_csrf=<CSRF-DEGERI>' \
  -H 'x-csrf-token: <CSRF-DEGERI>' -H 'Content-Type: application/json' \
  -d '{"id":"<BASTURU-UUID>","status":"accepted","note":"<YONETICI-NOTU>"}'
# 200 {"ok":true,"application":{...}}
```

Arama değeri virgül/parantez/yüzde/ters eğik çizgiden arındırılır ve 100 karaktere kırpılır (PostgREST filtre enjeksiyonu önlemi).

## 3. `admin-questions` — soru ve seçenek yönetimi

**Amaç:** Dinamik başvuru sorularını yönetmek.
**Eylemler:** `GET` (tüm sorular + seçenekleri), `POST` (oluştur), `POST /reorder` veya `{"action":"reorder","ids":[...]}`, `PATCH` (güncelle), `DELETE` (sil).
**Yetki:** oturum + CSRF (GET dışı). Tüm değişiklikler denetim günlüğüne yazılır.

```bash
curl "<SUPABASE_URL>/functions/v1/admin-questions" -H 'Cookie: lsc_admin_session=<OTURUM>'
# 200 {"ok":true,"questions":[{"id":"<UUID>","question_text":"...","options":[...]}]}

curl -X POST "<SUPABASE_URL>/functions/v1/admin-questions/reorder" \
  -H 'Cookie: lsc_admin_session=<OTURUM>; lsc_csrf=<CSRF-DEGERI>' \
  -H 'x-csrf-token: <CSRF-DEGERI>' -H 'Content-Type: application/json' \
  -d '{"ids":["<UUID-1>","<UUID-2>"]}'
# 200 {"ok":true}
```

Soru silinse bile eski başvuruların cevapları korunur: `application_answers` satırında soru metni/tipi/seçenek anlık görüntüsü kopyalanır.

## 4. `admin-positions` — pozisyon yönetimi

**Amaç:** `rehber`/`aac` pozisyonlarını, aktiflik ve açıklamaları yönetmek.
**Eylemler:** `GET` (liste), `POST` (ekle), `PATCH` (güncelle; `id` gövde veya query).
**Yetki:** oturum + CSRF (GET dışı).

```bash
curl "<SUPABASE_URL>/functions/v1/admin-positions" -H 'Cookie: lsc_admin_session=<OTURUM>'
# 200 {"ok":true,"positions":[{"slug":"rehber","name":"Rehber","is_active":true}]}

curl -X PATCH "<SUPABASE_URL>/functions/v1/admin-positions" \
  -H 'Cookie: lsc_admin_session=<OTURUM>; lsc_csrf=<CSRF-DEGERI>' \
  -H 'x-csrf-token: <CSRF-DEGERI>' -H 'Content-Type: application/json' \
  -d '{"id":"<POZISYON-UUID>","is_active":false}'
# 200 {"ok":true,"position":{...}}
```

## 5. `admin-scores` — puanlar ve yönetici notları

**Amaç:** Kriter bazlı puanlama ve özel notları kaydetmek.
**Eylemler:** `GET ?application_id=<UUID>` (puanlar + notlar), `POST` (puan: `{application_id, scores:{...}}`), `POST` not (`{"action":"note","application_id":"<UUID>","note":"..."}` veya `/notes` yolu).
**Yetki:** oturum + CSRF (GET dışı). Kriter anahtarları bilinen 6 değerden biri olmalı; ağırlık toplamı 100'ü aşamaz.

```bash
curl "<SUPABASE_URL>/functions/v1/admin-scores?application_id=<BASTURU-UUID>" \
  -H 'Cookie: lsc_admin_session=<OTURUM>'
# 200 {"ok":true,"scores":[...],"notes":[...]}

curl -X POST "<SUPABASE_URL>/functions/v1/admin-scores" \
  -H 'Cookie: lsc_admin_session=<OTURUM>; lsc_csrf=<CSRF-DEGERI>' \
  -H 'x-csrf-token: <CSRF-DEGERI>' -H 'Content-Type: application/json' \
  -d '{"application_id":"<BASTURU-UUID>","scores":{"communication":18,"knowledge":20}}'
# 200 {"ok":true,"total_score":38}

curl -X POST "<SUPABASE_URL>/functions/v1/admin-scores" \
  -H 'Cookie: lsc_admin_session=<OTURUM>; lsc_csrf=<CSRF-DEGERI>' \
  -H 'x-csrf-token: <CSRF-DEGERI>' -H 'Content-Type: application/json' \
  -d '{"action":"note","application_id":"<BASTURU-UUID>","note":"<YONETICI-NOTU>"}'
# 201 {"ok":true,"note":{...}}
```

Yönetici notları `/admin` dışında hiçbir yanıtta yer almaz; özellikle herkese açık sorguda döndürülmez.

## 6. `admin-settings` — uygulama ayarları

**Amaç:** Başvuru açıklığı, kapalı mesajı ve IP başına saatlik sınırı yönetmek.
**Eylemler:** `GET` (tüm ayarlar), `PATCH`/`POST` (`{"settings":{...}}` veya `{"key":"...","value":...}`).
**Yetki:** oturum + CSRF (GET dışı).

```bash
curl "<SUPABASE_URL>/functions/v1/admin-settings" -H 'Cookie: lsc_admin_session=<OTURUM>'
# 200 {"ok":true,"settings":{"applications_open":true,"rate_limit_per_ip_per_hour":5},"rows":[...]}

curl -X PATCH "<SUPABASE_URL>/functions/v1/admin-settings" \
  -H 'Cookie: lsc_admin_session=<OTURUM>; lsc_csrf=<CSRF-DEGERI>' \
  -H 'x-csrf-token: <CSRF-DEGERI>' -H 'Content-Type: application/json' \
  -d '{"settings":{"applications_open":true,"closed_message":"<KAPALI-MESAJI>"}}'
# 200 {"ok":true,"settings":{...},"rows":[...]}
```

## 7. `public-status` — başvuru durumu sorgulama

**Amaç:** Takip numarası ve gizli sorgu anahtarıyla yalnızca güvenli durum bilgilerini döndürmek.
**Eylem:** `POST {"tracking_no":"LSC-2026-XXXXXX","query_token":"<SORGU-ANAHTARI>"}`.
**Yetki:** herkese açık; doğrulama `SECURITY DEFINER` RPC (`lookup_application`) içinde yapılır. Ham anahtar saklanmaz, SHA-256 özeti karşılaştırılır.

```bash
curl -X POST "<SUPABASE_URL>/functions/v1/public-status" \
  -H 'Content-Type: application/json' -H 'apikey: <ANON-KEY>' \
  -d '{"tracking_no":"LSC-2026-ABC234","query_token":"<SORGU-ANAHTARI>"}'
# 200 {"ok":true,"application":{"tracking_no":"LSC-2026-ABC234","status":"pending","position_slug":"rehber","submitted_at":"..."}}
# 404 {"ok":false,"error":"Başvuru bulunamadı veya sorgu anahtarı hatalı.","code":"not_found"}
```

Notlar, puanlar, e-posta ve IP özeti bu yanıtta **asla** yer almaz.

## 8. `submit-application` — başvuru alma

**Amaç:** Yeni başvuru ve cevapları kaydetmek, tek kullanımlık sorgu anahtarı üretmek.
**Eylem:** `POST` (gövde: `position_slug`, `applicant_minecraft_username`, `applicant_discord_username`, `age`, `daily_hours`, `answers`, isteğe bağlı `applicant_email`, `website` (honeypot), `elapsed_ms`).
**Yetki:** herkese açık; Zod doğrulaması, honeypot, ≥3000 ms doldurma süresi, atomik IP hız sınırı (varsayılan 5), genel `applications_open` **ve** pozisyona özel `${slug}_applications_open` ayarları. Yaş 16–99'dur; Discord kullanıcı adı zorunlu bir düz metin alanıdır ve 3–32 karakter, yalnızca harf/rakam/`.`/`_` kuralına uyar.

```bash
curl -X POST "<SUPABASE_URL>/functions/v1/submit-application" \
  -H 'Content-Type: application/json' -H 'apikey: <ANON-KEY>' \
  -d '{"position_slug":"rehber","applicant_minecraft_username":"<MINECRAFT-ADI>","applicant_discord_username":"<DISCORD-ADI>","age":17,"daily_hours":10,"answers":{"<SORU-UUID>":"<CEVAP>"},"website":"","elapsed_ms":12000}'
# 200 {"ok":true,"tracking_no":"LSC-2026-ABC234","query_token":"<SORGU-ANAHTARI>"}
# 429 {"ok":false,"error":"Başvuru çok hızlı gönderildi...","code":"too_fast"}
```

Sorular ve seçenekler **yalnızca veritabanından** okunur; istemcinin gönderdiği soru metni doğrulanmaz. Cevaplar soru anlık görüntüsüyle birlikte saklanır. sorgu anahtarı yalnızca bu yanıtta bir kez görünür; veritabanında SHA-256 özeti tutulur.

## Discord kullanıcı adı

Discord kullanıcı adı başvuranın forma kendisi yazdığı zorunlu bir alandır. 3–32 karakter olmalı ve yalnızca harf, rakam, `.` ve `_` içermelidir. Hesap bağlama/OAuth akışı, bot, DM bildirimi ve ek bir Discord ayarı kullanılmaz; bu değer yalnızca başvuru kaydında saklanır.

---

## Gizli anahtar tablosu

| Secret | Kullanan uçlar | Not |
| --- | --- | --- |
| `SUPABASE_URL` | tümü | `VITE_SUPABASE_URL` yedeği okunur. |
| `SUPABASE_SERVICE_ROLE_KEY` | tümü | Yalnızca Edge; RLS'yi atlar. |
| `SESSION_SECRET` | `admin-auth` ve dolayısıyla tüm yönetici uçları | Oturum HMAC imzası. |
| `ADMIN_SETUP_SECRET` | `admin-auth` | `x-admin-setup-secret` başlığıyla karşılaştırılır; yoksa `setup` eylemi kapalıdır. |
| `RATE_LIMIT_SALT` | `submit-application` | IP özetleme tuzu. |
| `ALLOWED_ORIGINS` | tümü (CORS) | Virgülle ayrılmış origin listesi. |

Bu değerler hiçbir yanıta, istemci paketine veya GitHub Actions dosyasına yazılmaz. Döndürme (rotation) ve saklama kuralları: [guvenlik.md](guvenlik.md).

## Dağıtım ve yeniden dağıtım

```bash
supabase login
supabase link --project-ref <PROJE-REFERANSI>
supabase secrets set SUPABASE_URL=<...> SUPABASE_SERVICE_ROLE_KEY=<...> SESSION_SECRET=<...> \
  ADMIN_SETUP_SECRET=<edge-kurulum-ici-rastgele-deger>

for fn in admin-auth admin-applications admin-questions admin-positions \
          admin-scores admin-settings public-status submit-application; do
  supabase functions deploy "$fn" --no-verify-jwt
done

supabase functions list        # dağıtılan uçları ve sürümleri görür
```

`--no-verify-jwt`: kimlik doğrulama uçların içinde (oturum çerezi / hız sınırı) yapıldığı için Gateway JWT doğrulaması kapatılır. Yeni secret değeri uçların davranışını anında etkiler; kod değişikliğinde ilgili ucu yeniden dağıtın.

## Loglama ve izleme

- Supabase Dashboard → **Edge Functions → <uç-adı> → Logs**: istek durum kodları, `configuration` (503) ve `csrf` (403) gibi hata kodları görülebilir.
- Supabase Dashboard → **Database → Table Editor**: `audit_logs` (salt okunur), `application_history`, `rate_limits` tabloları operasyonel izleme için kullanılabilir.
- Başarısız Edge isteklerinde yanıt gövdesi `{"ok":false,"error":"...","code":"..."}` biçimindedir; `code` değeri loglarla eşleştirilebilir.
- Ham parola, oturum belirteci ve `service_role` anahtarı loglara yazılmaz. Kullanıcıya dönen hata mesajları geneldir.
- Yüksek hacimde `rate_limits` ve eski oturum kayıtlarının temizliği için `0003_functions_triggers.sql` içindeki `cleanup_old_rate_limits()` / `cleanup_expired_sessions()` yardımcıları kullanılabilir.
