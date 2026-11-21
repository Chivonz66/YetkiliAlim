-- Luminacraft Staff Center — pozisyon açıklık ayarlarının herkese açık okunması
--
-- admin-positions `${slug}_applications_open` anahtarlarını yazar. 0002'nin sabit
-- allowlist'i bu anahtarları kapsamadığı için frontend pozisyonun kapalı olduğunu
-- göremiyordu. 0002 yeni kurulumlar için güncellendi; bu dosya mevcut veritabanına
-- aynı yetkiyi ileriye dönük olarak verir.

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
