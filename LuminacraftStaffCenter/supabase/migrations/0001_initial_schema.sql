-- Luminacraft Staff Center — ilk şema (PostgreSQL / Supabase)
-- Tüm tanımlar SAFE (service_role) tarafından yönetilir; genel erişim 0002 dosyasında kısıtlanır.
-- Tüm tablolar uuid birincil anahtar ve timestamptz zaman damgası kullanır.

-- Şifreleme yardımcıları (gen_random_uuid ve digest) için gerekli uzantı.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Başvuru yapılabilecek pozisyonlar.
CREATE TABLE IF NOT EXISTS public.positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.positions IS 'Başvuruya açık pozisyonlar (rehber, aac).';

-- Soru kategorileri; adlar istemci sabitleriyle birebir aynıdır.
CREATE TABLE IF NOT EXISTS public.question_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.question_categories IS 'Soruların gruplandığı kategoriler (general, rehber, aac, experience, scenario).';

-- Soru tanımları. position_slug NULL ise soru tüm pozisyonlara sorulur.
CREATE TABLE IF NOT EXISTS public.questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES public.question_categories(id) ON DELETE SET NULL,
  position_slug text NULL,
  question_text text NOT NULL,
  help_text text,
  question_type text NOT NULL CHECK (question_type IN ('short_text','long_text','number','single_choice','multiple_choice','yes_no','checkbox')),
  is_required boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  min_length integer,
  max_length integer,
  min_value numeric,
  max_value numeric,
  options_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT questions_uzunluk_araligi CHECK (min_length IS NULL OR max_length IS NULL OR min_length <= max_length),
  CONSTRAINT questions_deger_araligi CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value)
);

COMMENT ON COLUMN public.questions.position_slug IS 'NULL değeri sorunun tüm pozisyonlar için geçerli olduğunu belirtir.';
COMMENT ON COLUMN public.questions.options_snapshot IS 'Gönderim anındaki seçeneklerin anlık görüntüsü; cevaplarla birlikte de kopyalanır.';

-- Çoklu seçenek sorularının seçenekleri. Soru silindiğinde seçenekler de silinir.
CREATE TABLE IF NOT EXISTS public.question_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  label text NOT NULL,
  value text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true
);

COMMENT ON TABLE public.question_options IS 'Seçmeli soruların etkin seçenekleri.';

-- Değerlendirme ölçütleri; ağırlıkların toplamı 100 olmalıdır (0003 kontrolü).
CREATE TABLE IF NOT EXISTS public.score_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  criterion_key text NOT NULL UNIQUE,
  label text NOT NULL,
  weight integer NOT NULL CHECK (weight >= 0 AND weight <= 100),
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.score_criteria IS 'Puanlama kriterleri ve yüzdesel ağırlıkları (toplam 100).';

-- Başvurular. query_token_hash, sırrın yalnızca sha256 hex karşılığıdır; ham anahtar asla saklanmaz.
CREATE TABLE IF NOT EXISTS public.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_no text NOT NULL UNIQUE,
  query_token_hash text NOT NULL,
  position_slug text NOT NULL,
  applicant_minecraft_username text NOT NULL,
  applicant_discord_username text NOT NULL,
  discord_user_id text,
  discord_connected boolean NOT NULL DEFAULT false,
  age integer,
  daily_hours numeric,
  minecraft_experience text,
  staff_experience text,
  self_introduction text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewing','accepted','rejected')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid,
  notification_status text NOT NULL DEFAULT 'none' CHECK (notification_status IN ('none','queued','pending','sent','failed')),
  source_ip_hash text,
  CONSTRAINT applications_yas_araligi CHECK (age IS NULL OR (age >= 10 AND age <= 120)),
  CONSTRAINT applications_gunluk_saat_araligi CHECK (daily_hours IS NULL OR (daily_hours >= 0 AND daily_hours <= 24)),
  CONSTRAINT applications_minecraft_kullanici_adi CHECK (applicant_minecraft_username ~ '^[A-Za-z0-9_]{3,32}$'),
  CONSTRAINT applications_discord_kullanici_adi CHECK (applicant_discord_username ~ '^[A-Za-z0-9_.]{3,32}$'),
  CONSTRAINT applications_sorgu_anahtari_hex CHECK (query_token_hash ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE public.applications IS 'Başvuru kayıtları; takip anahtarının kendisi saklanmaz, yalnızca sha256 özeti tutulur.';
COMMENT ON COLUMN public.applications.query_token_hash IS '32 baytlık gizli sorgu anahtarının sha256 hex özeti (64 karakter).';
COMMENT ON COLUMN public.applications.source_ip_hash IS 'Başvuruyu yapan IP adresinin tek yönlü özeti; ham IP saklanmaz.';

-- Cevaplar: soru silinse bile eski başvuruların cevapları korunur.
-- question_id alanına bilinçli olarak FK eklenmez; soru metni, tipi, kategorisi ve
-- seçenek anlık görüntüsü cevabın kendi içinde kopyalanır.
CREATE TABLE IF NOT EXISTS public.application_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  question_id uuid NOT NULL,
  question_text text NOT NULL,
  question_type text NOT NULL,
  category_name text,
  position_slug text,
  options_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.application_answers IS 'Eski başvuruların cevaplarını korumak için soru bilgileri kopyalanır; question_id üzerinde FK yoktur.';

-- Başvuru başına kriter puanları; aynı kriter bir başvuruda yalnızca bir kez puanlanır.
CREATE TABLE IF NOT EXISTS public.application_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  criterion_key text NOT NULL,
  points numeric NOT NULL DEFAULT 0 CHECK (points >= 0),
  weight_snapshot integer NOT NULL CHECK (weight_snapshot >= 0 AND weight_snapshot <= 100),
  scored_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, criterion_key)
);

COMMENT ON TABLE public.application_scores IS 'Kriter başına puanlar; puan, kaydedilen ağırlığı geçemez.';

-- Yönetici notları yalnızca yönetim tarafında görünür, herkese açık sorguda asla döndürülmez.
CREATE TABLE IF NOT EXISTS public.application_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  admin_id uuid,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.application_notes IS 'Yönetici notları — herkese açık sorgularda ve istemcide asla sunulmaz.';

-- Durum geçişlerinin değişmez kaydı.
CREATE TABLE IF NOT EXISTS public.application_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  from_status text CHECK (from_status IN ('pending','reviewing','accepted','rejected')),
  to_status text NOT NULL CHECK (to_status IN ('pending','reviewing','accepted','rejected')),
  action text NOT NULL,
  actor text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.application_history IS 'Durum değişikliklerinin denetlenebilir geçmişi.';

-- Yöneticiler. Parola biçimi: pbkdf2$210000$<saltHex>$<hashHex>
-- PBKDF2-SHA256, 210000 yineleme, 16 bayt tuz, 32 bayt anahtar.
CREATE TABLE IF NOT EXISTS public.admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  password_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

COMMENT ON COLUMN public.admins.password_hash IS 'pbkdf2$210000$<saltHex>$<hashHex> biçiminde PBKDF2-SHA256 özeti.';

-- Kullanıcı adı büyük/küçük harf duyarsız benzersizdir (citext benzeri davranış).
CREATE UNIQUE INDEX IF NOT EXISTS admins_username_lower_unique ON public.admins (lower(username));

-- Yönetici oturumları; yalnızca anahtar özetleri tutulur.
CREATE TABLE IF NOT EXISTS public.admin_sessions (
  token_hash text PRIMARY KEY,
  admin_id uuid NOT NULL REFERENCES public.admins(id) ON DELETE CASCADE,
  csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

COMMENT ON TABLE public.admin_sessions IS 'Oturum anahtarının ham değeri değil, sha256 özeti saklanır.';

-- Uygulama ayarları; değerler JSONB olarak tutulur.
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- IP başına istek sınırları (anahtar, pencere başlangıcı).
CREATE TABLE IF NOT EXISTS public.rate_limits (
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  hit_count integer NOT NULL DEFAULT 1 CHECK (hit_count >= 0),
  PRIMARY KEY (key, window_start)
);

-- Discord bağlantıları; OAuth durum anahtarının yalnızca özeti tutulur.
CREATE TABLE IF NOT EXISTS public.discord_links (
  discord_user_id text PRIMARY KEY,
  discord_username text NOT NULL,
  application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  oauth_state_hash text
);

COMMENT ON COLUMN public.discord_links.oauth_state_hash IS 'OAuth durum anahtarının tek yönlü özeti; ham değer saklanmaz.';

-- Bildirim kuyruğu (Discord gönderimleri).
CREATE TABLE IF NOT EXISTS public.notification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  discord_user_id text,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

-- Denetim kayıtları yalnızca eklenir; 0003 dosyasındaki tetikleyici UPDATE/DELETE'i engeller.
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type text NOT NULL,
  actor_id text,
  action text NOT NULL,
  target_table text,
  target_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  ip_hash text
);

COMMENT ON TABLE public.audit_logs IS 'Salt okunur denetim günlüğü; güncelleme ve silme tetikleyici tarafından reddedilir.';
