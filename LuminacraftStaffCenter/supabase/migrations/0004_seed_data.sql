-- Luminacraft Staff Center — başlangıç verileri
-- Tüm eklemeler ON CONFLICT DO NOTHING kullanır; göç tekrarlandığında veri çoğalmaz.
-- Sabit kimlikler yalnızca tohum kayıtları içindir; uygulama genelinde güvenli rastgele uuid kullanılır.

-- Aktif pozisyonlar (istemci sabitleriyle aynı slug ve açıklamalar).
INSERT INTO public.positions (slug, name, description, is_active, sort_order) VALUES
  ('rehber', 'Rehber', 'Topluluk rehberliği ve oyuncu desteği ekibi.', true, 10),
  ('aac', 'AAC', 'AAC sunucu ve topluluk yönetimi ekibi.', true, 20)
ON CONFLICT (slug) DO NOTHING;

-- Beş soru kategorisi; adlar QUESTION_CATEGORIES sabitiyle birebir aynıdır.
INSERT INTO public.question_categories (id, slug, name, description, sort_order, is_active) VALUES
  ('00000000-0000-4000-8000-000000000001', 'general', 'Genel bilgiler', 'Başvuranın temel bilgileri.', 10, true),
  ('00000000-0000-4000-8000-000000000002', 'rehber', 'Rehber soruları', 'Rehberlik başvurusuna özel sorular.', 20, true),
  ('00000000-0000-4000-8000-000000000003', 'aac', 'AAC soruları', 'AAC başvurusuna özel sorular.', 30, true),
  ('00000000-0000-4000-8000-000000000004', 'experience', 'Deneyim', 'Önceki deneyimler ve katkılar.', 40, true),
  ('00000000-0000-4000-8000-000000000005', 'scenario', 'Senaryo değerlendirmesi', 'Durum bazlı değerlendirme soruları.', 50, true)
ON CONFLICT (slug) DO NOTHING;

-- Altı değerlendirme ölçütü; ağırlık toplamı tam olarak 100'dür.
INSERT INTO public.score_criteria (criterion_key, label, weight, description, sort_order, is_active) VALUES
  ('communication', 'İletişim', 20, 'Açık, saygılı ve anlaşılır iletişim becerisi.', 10, true),
  ('knowledge', 'Bilgi seviyesi', 20, 'Sunucu kuralları ve Minecraft bilgisi.', 20, true),
  ('responsibility', 'Sorumluluk', 15, 'Görevleri zamanında ve özenle yerine getirme.', 30, true),
  ('problem_solving', 'Problem çözme', 15, 'Sorunları analiz edip çözüm üretebilme.', 40, true),
  ('experience', 'Deneyim', 15, 'Önceki yönetim ve topluluk deneyimi.', 50, true),
  ('position_fit', 'Pozisyona uygunluk', 15, 'Başvurulan pozisyona genel uygunluk.', 60, true)
ON CONFLICT (criterion_key) DO NOTHING;

-- Başlangıç soruları: yedi soru tipinin tamamı, iki pozisyon ve genel/senaryo soruları.
-- position_slug NULL olan sorular tüm pozisyonlara sorulur.
INSERT INTO public.questions
  (id, category_id, position_slug, question_text, help_text, question_type,
   is_required, is_active, sort_order, min_length, max_length, min_value, max_value, options_snapshot)
VALUES
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', NULL,
   'Minecraft kullanıcı adın nedir?', 'Sunucuda görünmek istediğin adı yaz.', 'short_text',
   true, true, 10, 3, 32, NULL, NULL, '[]'::jsonb),

  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', NULL,
   'Discord kullanıcı adın nedir?', 'Örnek: luminacraft#1234', 'short_text',
   true, true, 20, 3, 32, NULL, NULL, '[]'::jsonb),

  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', NULL,
   'Yaşın kaç?', 'Yaşın 10 ile 120 arasında olmalıdır.', 'number',
   true, true, 30, NULL, NULL, 10, 120, '[]'::jsonb),

  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', NULL,
   'Günde ortalama kaç saat Minecraft oynuyorsun?', '0 ile 24 arasında bir sayı gir.', 'number',
   false, true, 40, NULL, NULL, 0, 24, '[]'::jsonb),

  ('10000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001', NULL,
   'Kendini kısaca tanıtır mısın?', 'En az 50, en fazla 2000 karakter.', 'long_text',
   true, true, 50, 50, 2000, NULL, NULL, '[]'::jsonb),

  ('10000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000001', NULL,
   'Daha önce bir sunucuda yönetici veya rehber olarak görev yaptın mı?', NULL, 'yes_no',
   true, true, 60, NULL, NULL, NULL, NULL,
   '[{"label":"Evet","value":"yes","sort_order":1},{"label":"Hayır","value":"no","sort_order":2}]'::jsonb),

  ('10000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000002', 'rehber',
   'Bir oyuncu haksız yere ceza aldığını iddia ederse ilk adımın ne olur?',
   'Sakin ve adil bir yaklaşımı anlat.', 'single_choice',
   true, true, 10, NULL, NULL, NULL, NULL,
   '[{"label":"Önce kayıtları ve kanıtları incelerim","value":"incele","sort_order":1},{"label":"Hemen cezayı kaldırırım","value":"kaldir","sort_order":2},{"label":"Konuyu yetkili yöneticilere iletirim","value":"yetkiliye_ilet","sort_order":3},{"label":"Şikâyeti kapatırım","value":"kapat","sort_order":4}]'::jsonb),

  ('10000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-000000000002', 'rehber',
   'Rehber olarak hangi konularda destek verebilirsin?', 'Birden fazla seçenek işaretleyebilirsin.', 'multiple_choice',
   true, true, 20, NULL, NULL, NULL, NULL,
   '[{"label":"Oyuncu sorunları","value":"oyuncu_destegi","sort_order":1},{"label":"Sunucu kuralları","value":"kurallar","sort_order":2},{"label":"Rapor inceleme","value":"raporlar","sort_order":3},{"label":"Etkinlik organizasyonu","value":"etkinlikler","sort_order":4},{"label":"Teknik destek","value":"teknik","sort_order":5}]'::jsonb),

  ('10000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-000000000003', 'aac',
   'AAC sunucusunda karşılaştığın bir problemi ve çözümünü anlatır mısın?',
   'En az 80 karakter yaz.', 'long_text',
   false, true, 10, 80, 4000, NULL, NULL, '[]'::jsonb),

  ('10000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000003', 'aac',
   'AAC ekibinde yer almak isteme nedenin nedir?', 'En uygun olanı seç.', 'single_choice',
   true, true, 20, NULL, NULL, NULL, NULL,
   '[{"label":"Topluluğa katkı sağlamak","value":"katki","sort_order":1},{"label":"Yönetim deneyimi kazanmak","value":"deneyim","sort_order":2},{"label":"Sunucuyu geliştirmek","value":"gelistirme","sort_order":3},{"label":"Arkadaşlarımın önerisi","value":"oneri","sort_order":4}]'::jsonb),

  ('10000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000005', NULL,
   'Senaryo: Bir oyuncu sohbette başka bir oyuncuya hakaret ediyor ve şikâyet iletiliyor. Durumu adım adım nasıl yönetirsin?',
   'En az 100 karakter yaz; kanıt, uyarı ve takip adımlarını belirt.', 'long_text',
   true, true, 70, 100, 5000, NULL, NULL, '[]'::jsonb),

  ('10000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000004', NULL,
   'Minecraft deneyimini ve topluluğa yaptığın önceki katkıları anlatır mısın?',
   'En az 60 karakter yaz.', 'long_text',
   false, true, 80, 60, 4000, NULL, NULL, '[]'::jsonb),

  ('10000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000001', NULL,
   'Başvuru bilgilerimin doğru olduğunu ve sunucu kurallarını okuduğumu onaylıyorum.', NULL, 'checkbox',
   true, true, 90, NULL, NULL, NULL, NULL, '[]'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Seçmeli soruların seçenekleri (soru kimlikleri yukarıdaki tohum kayıtlarıyla eşleşir).
INSERT INTO public.question_options (id, question_id, label, value, sort_order, is_active) VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000006', 'Evet', 'yes', 1, true),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000006', 'Hayır', 'no', 2, true),

  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000007', 'Önce kayıtları ve kanıtları incelerim', 'incele', 1, true),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000007', 'Hemen cezayı kaldırırım', 'kaldir', 2, true),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000007', 'Konuyu yetkili yöneticilere iletirim', 'yetkiliye_ilet', 3, true),
  ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000007', 'Şikâyeti kapatırım', 'kapat', 4, true),

  ('20000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000008', 'Oyuncu sorunları', 'oyuncu_destegi', 1, true),
  ('20000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000008', 'Sunucu kuralları', 'kurallar', 2, true),
  ('20000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000008', 'Rapor inceleme', 'raporlar', 3, true),
  ('20000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000008', 'Etkinlik organizasyonu', 'etkinlikler', 4, true),
  ('20000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000008', 'Teknik destek', 'teknik', 5, true),

  ('20000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000010', 'Topluluğa katkı sağlamak', 'katki', 1, true),
  ('20000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000010', 'Yönetim deneyimi kazanmak', 'deneyim', 2, true),
  ('20000000-0000-4000-8000-000000000014', '10000000-0000-4000-8000-000000000010', 'Sunucuyu geliştirmek', 'gelistirme', 3, true),
  ('20000000-0000-4000-8000-000000000015', '10000000-0000-4000-8000-000000000010', 'Arkadaşlarımın önerisi', 'oneri', 4, true)
ON CONFLICT (id) DO NOTHING;

-- Uygulama ayarlarının varsayılan değerleri.
INSERT INTO public.app_settings (key, value) VALUES
  ('site_title', '"Luminacraft Staff Center"'::jsonb),
  ('applications_open', 'true'::jsonb),
  ('closed_message', '"Başvurular şu anda kapalıdır. Lütfen daha sonra tekrar deneyin."'::jsonb),
  ('discord_enabled', 'false'::jsonb),
  ('min_minecraft_age_months', '12'::jsonb),
  ('rate_limit_per_ip_per_hour', '5'::jsonb)
ON CONFLICT (key) DO NOTHING;
