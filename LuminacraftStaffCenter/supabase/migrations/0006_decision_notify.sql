-- Luminacraft Staff Center — karar bildirimlerinde tekilleştirme ve güvenli gönderim
-- Bu dosya sürüm kontrolündeki göç tanımıdır; canlı veritabanına buradan uygulanmaz.

-- Aynı kararın iki kez kuyruğa alınmaması için doğal anahtar ve sahiplik zamanı.
ALTER TABLE public.notification_queue
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

-- Eski kuyruk satırlarının benzersiz anahtarını oluştur; yeni satırlarda anahtar
-- admin-applications tarafından decision:<application>:<status>:<decided_at> biçiminde üretilir.
UPDATE public.notification_queue
   SET idempotency_key = 'legacy:' || id::text
 WHERE idempotency_key IS NULL;

-- Geçmişte oluşmuş yinelenen bekleyen satırları koruyarak tek aktif satır bırakılır.
WITH siralama AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY application_id
           ORDER BY created_at ASC, id ASC
         ) AS sira
    FROM public.notification_queue
   WHERE status = 'pending'
)
UPDATE public.notification_queue q
   SET status = 'failed',
       last_error = COALESCE(q.last_error, 'Yinelenen bekleyen kuyruk satırı tekilleştirildi.')
  FROM siralama s
 WHERE q.id = s.id
   AND s.sira > 1;

CREATE UNIQUE INDEX IF NOT EXISTS notification_queue_idempotency_key_unique
  ON public.notification_queue (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notification_queue_one_pending_per_application
  ON public.notification_queue (application_id)
  WHERE status = 'pending';

COMMENT ON COLUMN public.notification_queue.idempotency_key IS
  'Karar kuyruğu satırının doğal anahtarı; aynı karar iki kez kuyruğa alınamaz.';
COMMENT ON COLUMN public.notification_queue.claimed_at IS
  'Gönderim için kilitlenen kuyruk satırının geçici sahiplik zamanı; gönderim bitince temizlenir.';

-- Bekleyen tek satırı kilitler. FOR UPDATE SKIP LOCKED eşzamanlı iki gönderimin
-- aynı satırı almasını engeller; eski kilitler sıfırlanarak kuyruk tıkanmaz.
CREATE OR REPLACE FUNCTION public.claim_pending_notification(p_application_id uuid)
RETURNS SETOF public.notification_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.notification_queue
     SET claimed_at = NULL
   WHERE application_id = p_application_id
     AND status = 'pending'
     AND claimed_at IS NOT NULL
     AND claimed_at < now() - interval '10 minutes';

  RETURN QUERY
  WITH secilen AS (
    SELECT q.id
      FROM public.notification_queue q
     WHERE q.application_id = p_application_id
       AND q.status = 'pending'
       AND q.claimed_at IS NULL
     ORDER BY q.created_at ASC, q.id ASC
     FOR UPDATE SKIP LOCKED
     LIMIT 1
  )
  UPDATE public.notification_queue q
     SET claimed_at = now()
    FROM secilen s
   WHERE q.id = s.id
   RETURNING q.*;
END;
$$;

-- Başarısız bir satırın yeniden gönderimini de aynı kilit mekanizmasına bağlar.
CREATE OR REPLACE FUNCTION public.claim_failed_notification(p_notification_id uuid)
RETURNS SETOF public.notification_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.notification_queue
     SET claimed_at = NULL
   WHERE id = p_notification_id
     AND status = 'failed'
     AND claimed_at IS NOT NULL
     AND claimed_at < now() - interval '10 minutes';

  RETURN QUERY
  WITH secilen AS (
    SELECT q.id
      FROM public.notification_queue q
     WHERE q.id = p_notification_id
       AND q.status = 'failed'
       AND q.claimed_at IS NULL
     FOR UPDATE SKIP LOCKED
     LIMIT 1
  )
  UPDATE public.notification_queue q
     SET claimed_at = now()
    FROM secilen s
   WHERE q.id = s.id
   RETURNING q.*;
END;
$$;

COMMENT ON FUNCTION public.claim_pending_notification(uuid) IS
  'Başvuruya ait tek bekleyen bildirim satırını gönderim için kilitler.';
COMMENT ON FUNCTION public.claim_failed_notification(uuid) IS
  'Başarısız bildirim satırını yeniden gönderim için kilitler.';

REVOKE ALL ON FUNCTION public.claim_pending_notification(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_failed_notification(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_pending_notification(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_failed_notification(uuid) TO service_role;
