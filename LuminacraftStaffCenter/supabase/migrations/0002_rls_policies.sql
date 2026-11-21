-- Luminacraft Staff Center — satır düzeyi güvenlik (RLS)
-- Varsayılan olarak tüm tablolar kapalıdır. Yalnızca etkin soru/pozisyon/kategori/ölçüt
-- okuması anonim kullanıcıya açılır; tüm yazma işlemleri service_role üzerinden yapılır.

-- Tüm tablolar için RLS etkinleştirilir (service_role bu kısıtlamaları atlar).
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.score_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discord_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Herkese açık okuma: yalnızca etkin kayıtlar.
DROP POLICY IF EXISTS "Herkes etkin pozisyonlari okuyabilir" ON public.positions;
CREATE POLICY "Herkes etkin pozisyonlari okuyabilir"
  ON public.positions FOR SELECT TO anon, authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "Herkes etkin kategorileri okuyabilir" ON public.question_categories;
CREATE POLICY "Herkes etkin kategorileri okuyabilir"
  ON public.question_categories FOR SELECT TO anon, authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "Herkes etkin sorulari okuyabilir" ON public.questions;
CREATE POLICY "Herkes etkin sorulari okuyabilir"
  ON public.questions FOR SELECT TO anon, authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "Herkes etkin secenekleri okuyabilir" ON public.question_options;
CREATE POLICY "Herkes etkin secenekleri okuyabilir"
  ON public.question_options FOR SELECT TO anon, authenticated
  USING (
    is_active = true
    AND EXISTS (
      SELECT 1 FROM public.questions q
      WHERE q.id = question_id AND q.is_active = true
    )
  );

DROP POLICY IF EXISTS "Herkes etkin puanlama olcutlerini okuyabilir" ON public.score_criteria;
CREATE POLICY "Herkes etkin puanlama olcutlerini okuyabilir"
  ON public.score_criteria FOR SELECT TO anon, authenticated
  USING (is_active = true);

-- Yönetim tabloları için açık reddetme ilkeleri. RLS zaten varsayılan olarak reddeder;
-- bu ilkeler niyeti belgelemek ve anonim/authenticated rollerini kesin olarak engellemek içindir.
DROP POLICY IF EXISTS "Basvurulara herkese acik erisim yok" ON public.applications;
CREATE POLICY "Basvurulara herkese acik erisim yok"
  ON public.applications FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "Cevaplara herkese acik erisim yok" ON public.application_answers;
CREATE POLICY "Cevaplara herkese acik erisim yok"
  ON public.application_answers FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "Puanlara herkese acik erisim yok" ON public.application_scores;
CREATE POLICY "Puanlara herkese acik erisim yok"
  ON public.application_scores FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "Yonetici notlarina herkese acik erisim yok" ON public.application_notes;
CREATE POLICY "Yonetici notlarina herkese acik erisim yok"
  ON public.application_notes FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "Basvuru gecmisine herkese acik erisim yok" ON public.application_history;
CREATE POLICY "Basvuru gecmisine herkese acik erisim yok"
  ON public.application_history FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "Yoneticilere herkese acik erisim yok" ON public.admins;
CREATE POLICY "Yoneticilere herkese acik erisim yok"
  ON public.admins FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "Yonetici oturumlarina herkese acik erisim yok" ON public.admin_sessions;
CREATE POLICY "Yonetici oturumlarina herkese acik erisim yok"
  ON public.admin_sessions FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "Uygulama ayarlarina herkese acik erisim yok" ON public.app_settings;
CREATE POLICY "Uygulama ayarlarina herkese acik erisim yok"
  ON public.app_settings FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- Yalnızca başvuru akışının ihtiyaç duyduğu public ayarlar okunabilir.
-- Diğer anahtarlar yukarıdaki açık reddetme politikasıyla kapalı kalır.
DROP POLICY IF EXISTS "Herkes public ayarlari okuyabilir" ON public.app_settings;
CREATE POLICY "Herkes public ayarlari okuyabilir"
  ON public.app_settings FOR SELECT TO anon, authenticated
  USING (
    key IN (
      'site_title',
      'applications_open',
      'closed_message',
      'discord_enabled',
      'min_minecraft_age_months',
      'rate_limit_per_ip_per_hour'
    )
    OR key ~ '^[a-z0-9_-]+_applications_open$'
  );
GRANT SELECT ON public.app_settings TO anon, authenticated;

DROP POLICY IF EXISTS "Hiz sinirlarina herkese acik erisim yok" ON public.rate_limits;
CREATE POLICY "Hiz sinirlarina herkese acik erisim yok"
  ON public.rate_limits FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "Discord baglantilarina herkese acik erisim yok" ON public.discord_links;
CREATE POLICY "Discord baglantilarina herkese acik erisim yok"
  ON public.discord_links FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "Bildirim kuyruguna herkese acik erisim yok" ON public.notification_queue;
CREATE POLICY "Bildirim kuyruguna herkese acik erisim yok"
  ON public.notification_queue FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "Denetim kayitlarina herkese acik erisim yok" ON public.audit_logs;
CREATE POLICY "Denetim kayitlarina herkese acik erisim yok"
  ON public.audit_logs FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- Herkese açık tablolara yazma izni yoktur: SELECT dışında ilke tanımlanmadı.
REVOKE ALL ON public.positions FROM anon, authenticated;
REVOKE ALL ON public.question_categories FROM anon, authenticated;
REVOKE ALL ON public.questions FROM anon, authenticated;
REVOKE ALL ON public.question_options FROM anon, authenticated;
REVOKE ALL ON public.score_criteria FROM anon, authenticated;
GRANT SELECT ON public.positions, public.question_categories, public.questions,
  public.question_options, public.score_criteria TO anon, authenticated;

-- Başvuru takibi: yalnızca doğru takip numarası + gizli sorgu anahtarı eşleşirse
-- güvenli alanlar ve durum geçmişi döner. Parola, not, IP veya cevap asla döndürülmez.
-- sha256, PostgreSQL çekirdek fonksiyonudur; ham anahtar hiçbir yere kaydedilmez.
CREATE OR REPLACE FUNCTION public.lookup_application(
  p_tracking_no text,
  p_query_token text
)
RETURNS TABLE (
  tracking_no text,
  position_slug text,
  status text,
  submitted_at timestamptz,
  decided_at timestamptz,
  notification_status text,
  status_history jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_tracking_no IS NULL OR p_query_token IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    a.tracking_no,
    a.position_slug,
    a.status,
    a.submitted_at,
    a.decided_at,
    a.notification_status,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'from_status', h.from_status,
            'to_status', h.to_status,
            'action', h.action,
            'created_at', h.created_at
          ) ORDER BY h.created_at
        )
        FROM public.application_history h
        WHERE h.application_id = a.id
      ),
      '[]'::jsonb
    ) AS status_history
  FROM public.applications a
  WHERE a.tracking_no = p_tracking_no
    AND a.query_token_hash = encode(sha256(convert_to(p_query_token, 'UTF8')), 'hex');
END;
$$;

COMMENT ON FUNCTION public.lookup_application(text, text) IS 'Gizli sorgu anahtarını doğrular ve yalnızca güvenli takip alanlarını döndürür.';

REVOKE ALL ON FUNCTION public.lookup_application(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_application(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.lookup_application(text, text) TO authenticated;

-- Herkese açık soru yükleme: etkin soruları ve etkin seçeneklerini tek çağrıda verir.
-- RLS doğrudan SELECT'e izin verse de bu işlev istemcinin güvenilir biçimde
-- soru listesi almasını sağlar (SECURITY DEFINER, salt okunur).
CREATE OR REPLACE FUNCTION public.get_public_questions(p_position_slug text DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  category_slug text,
  category_name text,
  position_slug text,
  question_type text,
  question_text text,
  help_text text,
  is_required boolean,
  sort_order integer,
  min_length integer,
  max_length integer,
  min_value numeric,
  max_value numeric,
  options_snapshot jsonb,
  options jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT
    q.id,
    c.slug AS category_slug,
    c.name AS category_name,
    q.position_slug,
    q.question_type,
    q.question_text,
    q.help_text,
    q.is_required,
    q.sort_order,
    q.min_length,
    q.max_length,
    q.min_value,
    q.max_value,
    q.options_snapshot,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', o.id,
            'label', o.label,
            'value', o.value,
            'sort_order', o.sort_order
          ) ORDER BY o.sort_order
        )
        FROM public.question_options o
        WHERE o.question_id = q.id AND o.is_active = true
      ),
      q.options_snapshot
    ) AS options
  FROM public.questions q
  LEFT JOIN public.question_categories c
    ON c.id = q.category_id AND c.is_active = true
  WHERE q.is_active = true
    AND (q.position_slug IS NULL OR q.position_slug = p_position_slug)
  ORDER BY c.sort_order, q.sort_order;
END;
$$;

COMMENT ON FUNCTION public.get_public_questions(text) IS 'Belirtilen pozisyon için etkin soruları ve seçeneklerini döndürür.';

REVOKE ALL ON FUNCTION public.get_public_questions(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_questions(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_questions(text) TO authenticated;
