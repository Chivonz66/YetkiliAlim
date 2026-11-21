-- Luminacraft Staff Center — ortak fonksiyonlar, tetikleyiciler ve dizinler

-- updated_at alanını her güncellemede otomatik yeniler.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_updated_at() IS 'updated_at sütununu güncelleme anına ayarlayan tetikleyici fonksiyonu.';

DROP TRIGGER IF EXISTS trg_positions_updated_at ON public.positions;
CREATE TRIGGER trg_positions_updated_at
  BEFORE UPDATE ON public.positions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_question_categories_updated_at ON public.question_categories;
CREATE TRIGGER trg_question_categories_updated_at
  BEFORE UPDATE ON public.question_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_questions_updated_at ON public.questions;
CREATE TRIGGER trg_questions_updated_at
  BEFORE UPDATE ON public.questions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_score_criteria_updated_at ON public.score_criteria;
CREATE TRIGGER trg_score_criteria_updated_at
  BEFORE UPDATE ON public.score_criteria
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_applications_updated_at ON public.applications;
CREATE TRIGGER trg_applications_updated_at
  BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_application_scores_updated_at ON public.application_scores;
CREATE TRIGGER trg_application_scores_updated_at
  BEFORE UPDATE ON public.application_scores
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_app_settings_updated_at ON public.app_settings;
CREATE TRIGGER trg_app_settings_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Başvuru takip numarası yedeği: istemci numara göndermezse okunaklı bir numara üretilir.
-- Karışıklığa yol açan 0/O/1/I karakterleri kullanılmaz (istemci üreticisiyle aynı alfabe).
CREATE OR REPLACE FUNCTION public.generate_tracking_no()
RETURNS text
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_alfabe text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_ek text := '';
  i integer;
BEGIN
  FOR i IN 1..6 LOOP
    v_ek := v_ek || substr(v_alfabe, floor(random() * length(v_alfabe))::integer + 1, 1);
  END LOOP;
  RETURN 'LSC-' || to_char(now() AT TIME ZONE 'UTC', 'YYYY') || '-' || v_ek;
END;
$$;

COMMENT ON FUNCTION public.generate_tracking_no() IS 'LSC-YYYY-XXXXXX biçiminde yedek başvuru numarası üretir.';

CREATE OR REPLACE FUNCTION public.set_application_tracking_no()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.tracking_no IS NULL OR btrim(NEW.tracking_no) = '' THEN
    NEW.tracking_no := public.generate_tracking_no();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_applications_tracking_no ON public.applications;
CREATE TRIGGER trg_applications_tracking_no
  BEFORE INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.set_application_tracking_no();

-- Durum değişikliğinde başvuru geçmişi ve denetim kaydı yazılır.
-- Hareket eden kişiyi Edge Function, app.current_actor ayarıyla iletebilir.
CREATE OR REPLACE FUNCTION public.log_application_status_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Bağlamı karar fonksiyonu işlem kapsamında ayarlar. Doğrudan güncellemelerde
  -- yalnızca karar durumları için decided_by değerine güvenilir; aksi hâlde
  -- 'system' kullanılır. Böylece her geçiş tek bir denetim kaydı üretir.
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

COMMENT ON FUNCTION public.log_application_status_change() IS 'Durum geçişini geçmiş tablosuna ve denetim günlüğüne yazar.';

DROP TRIGGER IF EXISTS trg_applications_status_change ON public.applications;
CREATE TRIGGER trg_applications_status_change
  AFTER UPDATE OF status ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.log_application_status_change();

-- Karar, aktör bağlamıyla aynı işlem içinde uygulanır. set_config(..., true)
-- ayarı yalnızca bu işlem için geçerlidir; başka isteklere sızmaz. Tetikleyici
-- aynı işlemde geçmişi ve denetim kaydını bir kez yazar; ayrıca elle denetim
-- eklemesine gerek kalmaz (çift kayıt önlenir).
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

-- Denetim günlüğü salt okunur (append-only): güncelleme, silme ve kırpma reddedilir.
CREATE OR REPLACE FUNCTION public.prevent_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Denetim kayıtları değiştirilemez veya silinemez (salt okunur günlük).';
END;
$$;

COMMENT ON FUNCTION public.prevent_audit_log_mutation() IS 'Denetim günlüğünde UPDATE/DELETE/TRUNCATE işlemlerini engeller.';

DROP TRIGGER IF EXISTS trg_audit_logs_append_only_row ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_append_only_row
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_mutation();

DROP TRIGGER IF EXISTS trg_audit_logs_append_only_truncate ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_append_only_truncate
  BEFORE TRUNCATE ON public.audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_audit_log_mutation();

-- Puanlama bütünlüğü: etkin ölçütlerin ağırlık toplamı 100 olmalıdır.
-- Tohum verisi tek harekette yüklendiği için kontrol işlem sonunda (deferrable) çalışır.
-- Tablo boşken (şema göçü aşamasında) hata verilmez; ekleme yapıldığında zorunludur.
CREATE OR REPLACE FUNCTION public.check_score_total()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_adet integer;
  v_toplam integer;
BEGIN
  SELECT count(*), COALESCE(sum(weight), 0)
    INTO v_adet, v_toplam
  FROM public.score_criteria
  WHERE is_active = true;

  IF v_adet > 0 AND v_toplam <> 100 THEN
    RAISE EXCEPTION 'Puanlama ölçütlerinin ağırlık toplamı 100 olmalıdır (bulunan: %).', v_toplam;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.check_score_total() IS 'Etkin puanlama ölçütlerinin ağırlık toplamının 100 olduğunu doğrular.';

DROP TRIGGER IF EXISTS trg_score_criteria_total ON public.score_criteria;
CREATE CONSTRAINT TRIGGER trg_score_criteria_total
  AFTER INSERT OR UPDATE OR DELETE ON public.score_criteria
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_score_total();

-- Başvuru başına puan, kaydedilen ağırlığı (weight_snapshot) aşamaz.
CREATE OR REPLACE FUNCTION public.check_application_score_points()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.points > NEW.weight_snapshot THEN
    RAISE EXCEPTION 'Puan (%) kaydedilen ağırlığı (%) aşamaz.', NEW.points, NEW.weight_snapshot;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.check_application_score_points() IS 'Başvuru puanının kriterin ağırlığını geçmesini engeller.';

DROP TRIGGER IF EXISTS trg_application_scores_limit ON public.application_scores;
CREATE TRIGGER trg_application_scores_limit
  BEFORE INSERT OR UPDATE OF points, weight_snapshot ON public.application_scores
  FOR EACH ROW EXECUTE FUNCTION public.check_application_score_points();

-- Süresi dolmuş yönetici oturumlarını temizler; silinen satır sayısını döner.
CREATE OR REPLACE FUNCTION public.cleanup_expired_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_silin integer;
BEGIN
  DELETE FROM public.admin_sessions WHERE expires_at < now();
  GET DIAGNOSTICS v_silin = ROW_COUNT;
  RETURN v_silin;
END;
$$;

COMMENT ON FUNCTION public.cleanup_expired_sessions() IS 'Süresi dolmuş oturum kayıtlarını siler.';

-- Eski hız sınırı pencerelerini temizler; silinen satır sayısını döner.
CREATE OR REPLACE FUNCTION public.cleanup_old_rate_limits(p_eski_sinir interval DEFAULT interval '2 hours')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_silin integer;
BEGIN
  DELETE FROM public.rate_limits WHERE window_start < now() - p_eski_sinir;
  GET DIAGNOSTICS v_silin = ROW_COUNT;
  RETURN v_silin;
END;
$$;

COMMENT ON FUNCTION public.cleanup_old_rate_limits(interval) IS 'Belirtilen süreyden eski hız sınırı kayıtlarını siler.';

-- Sık kullanılan sorgular için dizinler.
CREATE INDEX IF NOT EXISTS idx_applications_status_submitted_at
  ON public.applications (status, submitted_at);
CREATE INDEX IF NOT EXISTS idx_application_answers_application_id
  ON public.application_answers (application_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
  ON public.audit_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_questions_position_slug_is_active_sort_order
  ON public.questions (position_slug, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_rate_limits_key
  ON public.rate_limits (key);
