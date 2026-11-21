-- Luminacraft Staff Center — atomik başvuru gönderimi ve hız sınırı sayacı.
-- Bu göç yalnızca yeni fonksiyonlar ekler; 0001–0004 şemasını değiştirmez.
-- Edge fonksiyonları service_role ile çağırır; anon/authenticated doğrudan erişemez.

-- Başvuru + cevaplar + Discord bağlantısı tek bir veritabanı işleminde yazılır.
-- PL/pgSQL fonksiyonu tek bir işlemdir: herhangi bir INSERT hata verirse
-- fonksiyonun tamamı geri alınır (kısmi başvuru kalmaz).
CREATE OR REPLACE FUNCTION public.submit_application_atomic(
  p_application jsonb,
  p_answers jsonb,
  p_discord_user_id text DEFAULT NULL,
  p_discord_username text DEFAULT NULL,
  p_oauth_state_hash text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_application_id uuid;
  v_linked boolean := p_discord_user_id IS NOT NULL AND btrim(p_discord_user_id) <> '';
  v_discord_username text;
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
    discord_user_id,
    discord_connected,
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
    CASE WHEN v_linked THEN p_discord_user_id ELSE NULL END,
    v_linked,
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

  -- Cevaplar başvuru kimliğiyle birlikte, aynı işlemde yazılır.
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

  -- Discord kimliği yalnızca doğrulanmış bağlantı belirteciyle gelir;
  -- application_id istemciden alınmaz, yeni başvurunun kimliği kullanılır.
  IF v_linked THEN
    v_discord_username := COALESCE(
      NULLIF(btrim(p_discord_username), ''),
      p_application->>'applicant_discord_username',
      p_discord_user_id
    );

    INSERT INTO public.discord_links (
      discord_user_id,
      discord_username,
      application_id,
      linked_at,
      oauth_state_hash
    )
    VALUES (
      p_discord_user_id,
      v_discord_username,
      v_application_id,
      now(),
      p_oauth_state_hash
    )
    ON CONFLICT (discord_user_id) DO UPDATE
      SET discord_username = EXCLUDED.discord_username,
          application_id = EXCLUDED.application_id,
          linked_at = EXCLUDED.linked_at,
          oauth_state_hash = COALESCE(EXCLUDED.oauth_state_hash, public.discord_links.oauth_state_hash);
  END IF;

  RETURN v_application_id;
END;
$$;

COMMENT ON FUNCTION public.submit_application_atomic(jsonb, jsonb, text, text, text) IS
  'Başvuru, cevaplar ve doğrulanmış Discord bağlantısını tek işlemde yazar.';

REVOKE ALL ON FUNCTION public.submit_application_atomic(jsonb, jsonb, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_application_atomic(jsonb, jsonb, text, text, text) TO service_role;

-- Saatlik hız sınırı INSERT ... ON CONFLICT ... RETURNING ile atomik artırılır.
-- Ayrı SELECT + UPDATE/INSERT yarış durumunda limit aşımına yol açabileceğinden
-- kullanılmaz. Limit aşıldığında -1 döner; çağıran bu değeri reddeder.
CREATE OR REPLACE FUNCTION public.increment_rate_limit(
  p_key text,
  p_window_start timestamptz,
  p_limit integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hit_count integer;
BEGIN
  IF p_key IS NULL OR btrim(p_key) = '' OR p_window_start IS NULL THEN
    RAISE EXCEPTION 'Geçersiz hız sınırı anahtarı.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.rate_limits (key, window_start, hit_count)
  VALUES (p_key, p_window_start, 1)
  ON CONFLICT (key, window_start)
  DO UPDATE SET hit_count = public.rate_limits.hit_count + 1
  RETURNING hit_count INTO v_hit_count;

  IF p_limit IS NOT NULL AND v_hit_count > p_limit THEN
    RETURN -1;
  END IF;

  RETURN v_hit_count;
END;
$$;

COMMENT ON FUNCTION public.increment_rate_limit(text, timestamptz, integer) IS
  'Hız sınırı sayacını tek atomik UPSERT ile artırır ve yeni sayacı döndürür.';

REVOKE ALL ON FUNCTION public.increment_rate_limit(text, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_rate_limit(text, timestamptz, integer) TO service_role;
