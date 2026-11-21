-- Luminacraft Staff Center — canlı veritabanı için ileriye dönük uzlaştırma göçü
--
-- 0001/0003/0004 dosyaları ilk dağıtımdan sonra düzenlendiği için, zaten uygulanmış
-- bir veritabanının bu değişiklikleri alması gerekir. 0005_submit_atomic.sql
-- atomik gönderimi tanımlar; 0006_decision_notify.sql artık yer tutucudur ve
-- Discord bildirimleri 0009 ile kaldırılır. Bu dosya onları tekrar tanımlamaz.
-- Yeni kurulumlarda 0001→0009 sırasıyla uygulanır.

-- Yaş aralığı 16–99; mevcut satırların denetimi ihlal etmediğinden emin ol.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.applications
    WHERE age IS NOT NULL AND (age < 16 OR age > 99)
  ) THEN
    RAISE EXCEPTION 'applications tablosunda 16–99 dışında yaş var; 0007 öncesi temizlenmeli.';
  END IF;
END $$;

-- 0001: applications_yas_araligi CHECK (10–120) → (16–99)
ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_yas_araligi;
ALTER TABLE public.applications
  ADD CONSTRAINT applications_yas_araligi
  CHECK (age IS NULL OR (age >= 16 AND age <= 99));

-- 0001: atomik ilk yönetici oluşturma RPC'si (danışma kilidi + tek işlem)
CREATE OR REPLACE FUNCTION public.create_first_admin(p_username text, p_password_hash text)
RETURNS TABLE (id uuid, username text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('lsc-first-admin'));
  IF EXISTS (SELECT 1 FROM public.admins) THEN
    RAISE EXCEPTION 'admin_exists';
  END IF;
  IF p_username IS NULL OR p_username !~ '^[A-Za-z0-9_.-]{3,32}$' THEN
    RAISE EXCEPTION 'invalid_username';
  END IF;
  IF p_password_hash IS NULL OR p_password_hash !~ '^pbkdf2\$210000\$[0-9a-f]{32}\$[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_password_hash';
  END IF;
  RETURN QUERY
    INSERT INTO public.admins (username, password_hash)
    VALUES (p_username, p_password_hash)
    RETURNING public.admins.id, public.admins.username;
END;
$$;

REVOKE ALL ON FUNCTION public.create_first_admin(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_first_admin(text, text) TO service_role;

-- 0003: durum geçişi tetikleyicisi artık karar aktörünü de dikkate alıyor.
-- Tetikleyicinin kendisi değişmedi; CREATE OR REPLACE FUNCTION yeterlidir.
CREATE OR REPLACE FUNCTION public.log_application_status_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_akteur text := COALESCE(
    NULLIF(current_setting('app.current_actor', true), ''),
    CASE WHEN NEW.status IN ('accepted', 'rejected') THEN NULLIF(NEW.decided_by::text, '') END,
    'system'
  );
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.application_history
      (application_id, from_status, to_status, action, actor, details, created_at)
    VALUES
      (NEW.id, OLD.status, NEW.status, 'status_change', v_akteur,
       jsonb_build_object('from', OLD.status, 'to', NEW.status), now());

    INSERT INTO public.audit_logs
      (actor_type, actor_id, action, target_table, target_id, details, created_at, ip_hash)
    VALUES
      (
        CASE WHEN v_akteur = 'system' THEN 'system' ELSE 'admin' END,
        v_akteur,
        'application_status_change',
        'applications',
        NEW.id::text,
        jsonb_build_object(
          'tracking_no', NEW.tracking_no,
          'from_status', OLD.status,
          'to_status', NEW.status
        ),
        now(),
        NULLIF(current_setting('app.current_ip_hash', true), '')
      );
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.log_application_status_change() IS
  'Durum geçişini geçmiş tablosuna ve denetim günlüğüne yazar; karar aktörünü kullanır.';

-- 0003: karar, işlem kapsamlı aktör bağlamıyla tek işlemde uygulanır.
CREATE OR REPLACE FUNCTION public.apply_application_decision(
  p_application_id uuid,
  p_status text,
  p_decided_at timestamptz,
  p_decided_by uuid
)
RETURNS public.applications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_kayit public.applications;
BEGIN
  IF p_status NOT IN ('pending', 'reviewing', 'accepted', 'rejected') THEN
    RAISE EXCEPTION 'Geçersiz başvuru durumu: %.', p_status;
  END IF;
  IF p_decided_by IS NULL THEN
    RAISE EXCEPTION 'Karar aktörü belirtilmeli.';
  END IF;

  PERFORM set_config('app.current_actor', p_decided_by::text, true);

  UPDATE public.applications
     SET status = p_status,
         decided_at = p_decided_at,
         decided_by = p_decided_by
   WHERE id = p_application_id
   RETURNING * INTO v_kayit;

  RETURN v_kayit;
END;
$$;

COMMENT ON FUNCTION public.apply_application_decision(uuid, text, timestamptz, uuid) IS
  'Yönetici kararını işlem kapsamlı aktör bağlamıyla uygular; tetikleyici denetimi tek kez yazar.';

REVOKE ALL ON FUNCTION public.apply_application_decision(uuid, text, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_application_decision(uuid, text, timestamptz, uuid) TO service_role;

-- 0004: tohum soru satırı ON CONFLICT DO NOTHING ile eklendiği için yaş metni
-- ve sınırlar mevcut veritabanında açıkça güncellenmelidir.
UPDATE public.questions
   SET help_text = 'Yaşın 16 ile 99 arasında olmalıdır.',
       min_value = 16,
       max_value = 99
 WHERE id = '10000000-0000-4000-8000-000000000003'::uuid;
