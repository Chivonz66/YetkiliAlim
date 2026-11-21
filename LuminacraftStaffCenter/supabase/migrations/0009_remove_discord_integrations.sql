-- Luminacraft Staff Center — Discord hesap bağlama ve DM bildirimlerinin kaldırılması
--
-- Discord kullanıcı adı zorunlu bir başvuru alanı olarak kalır; OAuth, bağlantı
-- belirteci, discord_links/notification_queue tabloları ve ilgili sütunlar kaldırılır.
-- Bu dosya hem yeni kurulumlarda (0001→0009) hem de mevcut canlı veritabanında
-- tek başına uygulanabilir; tüm ifadeler tekrar çalıştırılabilir (idempotent).

-- Eski kuyruk fonksiyonları RETURN SETOF notification_queue kullandığı için
-- tabloyu bırakmadan önce kaldırılmalıdır.
DROP FUNCTION IF EXISTS public.claim_pending_notification(uuid);
DROP FUNCTION IF EXISTS public.claim_failed_notification(uuid);

-- Eski 5 bağımsız değişkenli atomik RPC, kaldırılan Discord sütunlarına yazıyordu.
-- 2 bağımsız değişkenli kanonik sürüm aşağıda yeniden tanımlanır.
DROP FUNCTION IF EXISTS public.submit_application_atomic(jsonb, jsonb, text, text, text);

-- lookup_application dönüş tipi değiştiği için CREATE OR REPLACE yeterli değildir.
DROP FUNCTION IF EXISTS public.lookup_application(text, text);

DROP TABLE IF EXISTS public.notification_queue;
DROP TABLE IF EXISTS public.discord_links;

ALTER TABLE public.applications
  DROP COLUMN IF EXISTS discord_user_id,
  DROP COLUMN IF EXISTS discord_connected,
  DROP COLUMN IF EXISTS notification_status;

ALTER TABLE public.applications
  DROP CONSTRAINT IF EXISTS applications_discord_kullanici_adi;
ALTER TABLE public.applications
  ADD CONSTRAINT applications_discord_kullanici_adi
  CHECK (applicant_discord_username ~ '^[A-Za-z0-9_.]{3,32}$');

DELETE FROM public.app_settings WHERE key = 'discord_enabled';

-- Herkese açık durum sorgusu: yalnızca güvenli takip alanları; bildirim durumu yok.
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

-- Başvuru + cevaplar tek işlemde; Discord kullanıcı adı zorunlu başvuru alanıdır.
CREATE OR REPLACE FUNCTION public.submit_application_atomic(
  p_application jsonb,
  p_answers jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_application_id uuid;
BEGIN
  IF p_application IS NULL OR jsonb_typeof(p_application) <> 'object' THEN
    RAISE EXCEPTION 'Geçersiz başvuru verisi.' USING ERRCODE = '22023';
  END IF;

  IF p_answers IS NOT NULL AND jsonb_typeof(p_answers) NOT IN ('array', 'null') THEN
    RAISE EXCEPTION 'Geçersiz cevap verisi.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.applications (
    tracking_no,
    query_token_hash,
    position_slug,
    applicant_minecraft_username,
    applicant_discord_username,
    age,
    daily_hours,
    minecraft_experience,
    staff_experience,
    self_introduction,
    status,
    submitted_at,
    source_ip_hash
  )
  VALUES (
    p_application->>'tracking_no',
    p_application->>'query_token_hash',
    p_application->>'position_slug',
    p_application->>'applicant_minecraft_username',
    p_application->>'applicant_discord_username',
    (p_application->>'age')::integer,
    (p_application->>'daily_hours')::numeric,
    p_application->>'minecraft_experience',
    p_application->>'staff_experience',
    p_application->>'self_introduction',
    COALESCE(p_application->>'status', 'pending'),
    COALESCE((p_application->>'submitted_at')::timestamptz, now()),
    p_application->>'source_ip_hash'
  )
  RETURNING id INTO v_application_id;

  INSERT INTO public.application_answers (
    application_id,
    question_id,
    question_text,
    question_type,
    category_name,
    position_slug,
    options_snapshot,
    value
  )
  SELECT
    v_application_id,
    (item->>'question_id')::uuid,
    item->>'question_text',
    item->>'question_type',
    item->>'category_name',
    item->>'position_slug',
    COALESCE(item->'options_snapshot', '[]'::jsonb),
    item->'value'
  FROM jsonb_array_elements(COALESCE(p_answers, '[]'::jsonb)) AS answers(item);

  RETURN v_application_id;
END;
$$;

COMMENT ON FUNCTION public.submit_application_atomic(jsonb, jsonb) IS
  'Başvuru ve cevapları tek işlemde yazar; Discord kullanıcı adı zorunlu bir başvuru alanıdır.';

REVOKE ALL ON FUNCTION public.submit_application_atomic(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_application_atomic(jsonb, jsonb) TO service_role;

-- Tohum sorunun açıklaması artık eski #1234 biçimini önermemelidir.
UPDATE public.questions
   SET help_text = 'Örnek: luminacraft'
 WHERE id = '10000000-0000-4000-8000-000000000002'::uuid;
