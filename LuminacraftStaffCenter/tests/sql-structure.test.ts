import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Bu dosya yalnızca metin okur; canlı veritabanı, Supabase istemcisi veya ağ gerekmez.
// jsdom ortamında import.meta.url dosya adresi olmadığı için proje kökü çalışma dizininden bulunur.
function projeKokunuBul(): string {
  let dizin = process.cwd()
  for (let adim = 0; adim < 5; adim += 1) {
    if (existsSync(join(dizin, 'supabase/migrations/0001_initial_schema.sql'))) {
      return dizin
    }
    const ust = join(dizin, '..')
    if (ust === dizin) break
    dizin = ust
  }
  throw new Error('Luminacraft Staff Center proje kökü bulunamadı.')
}

const kok = projeKokunuBul()
const oku = (goreliYol: string): string =>
  readFileSync(join(kok, goreliYol), 'utf8')

// Diğer görevler 0005/0006 ekleyebileceğinden liste sabit kodlanmaz; diskten keşfedilir.
const GOC_DOSYALARI = readdirSync(join(kok, 'supabase/migrations'))
  .filter((dosya) => /^\d{4}_.+\.sql$/.test(dosya))
  .sort()

const GOC_METINLERI = GOC_DOSYALARI.map((dosya) => oku(`supabase/migrations/${dosya}`))
const TUM_SQL = GOC_METINLERI.join('\n')

// İlk dört göç dosyasının sözleşmesi sabittir; ek göçler TUM_SQL'e dahil edilir.
const SEMA = oku('supabase/migrations/0001_initial_schema.sql')
const RLS = oku('supabase/migrations/0002_rls_policies.sql')
const TETIKLEYICI = oku('supabase/migrations/0003_functions_triggers.sql')
const TOHUM = oku('supabase/migrations/0004_seed_data.sql')
const CLI = oku('scripts/create-first-admin.mjs')

const TABLOLAR = [
  'positions',
  'question_categories',
  'questions',
  'question_options',
  'score_criteria',
  'applications',
  'application_answers',
  'application_scores',
  'application_notes',
  'application_history',
  'admins',
  'admin_sessions',
  'app_settings',
  'rate_limits',
  'discord_links',
  'notification_queue',
  'audit_logs',
] as const

const SORU_TIPLERI = [
  'short_text',
  'long_text',
  'number',
  'single_choice',
  'multiple_choice',
  'yes_no',
  'checkbox',
] as const

const OLCUTLER: ReadonlyArray<readonly [string, string, number]> = [
  ['communication', 'İletişim', 20],
  ['knowledge', 'Bilgi seviyesi', 20],
  ['responsibility', 'Sorumluluk', 15],
  ['problem_solving', 'Problem çözme', 15],
  ['experience', 'Deneyim', 15],
  ['position_fit', 'Pozisyona uygunluk', 15],
]

const KATEGORILER: ReadonlyArray<readonly [string, string]> = [
  ['general', 'Genel bilgiler'],
  ['rehber', 'Rehber soruları'],
  ['aac', 'AAC soruları'],
  ['experience', 'Deneyim'],
  ['scenario', 'Senaryo değerlendirmesi'],
]

/** Verilen dizindeki kaynak dosyalarını özyinelemeli olarak bulur. */
function kaynakDosyalari(dizin: string): string[] {
  const sonuc: string[] = []
  for (const giris of readdirSync(dizin, { withFileTypes: true })) {
    const tamYol = join(dizin, giris.name)
    if (giris.isDirectory()) {
      sonuc.push(...kaynakDosyalari(tamYol))
    } else if (/\.(ts|tsx|js|jsx|css)$/.test(giris.name)) {
      sonuc.push(tamYol)
    }
  }
  return sonuc
}

/** Yorumları kaldırır; yalnızca çalışan kodda anahtar aramak için kullanılır. */
function yorumlariKaldir(kod: string): string {
  return kod.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('göç dosyaları', () => {
  it('göç dosyaları mevcut ve boş değil', () => {
    expect(GOC_DOSYALARI.length).toBeGreaterThanOrEqual(4)
    for (const dosya of GOC_DOSYALARI) {
      const tamYol = join(kok, 'supabase/migrations', dosya)
      expect(existsSync(tamYol), dosya).toBe(true)
      expect(oku(`supabase/migrations/${dosya}`).trim().length, dosya).toBeGreaterThan(200)
    }
  })

  it('pgcrypto uzantısı etkinleştirilmiş', () => {
    expect(TUM_SQL).toContain('CREATE EXTENSION IF NOT EXISTS pgcrypto')
  })

  it('on yedi tablonun tamamı uuid birincil anahtarla tanımlı', () => {
    expect(TABLOLAR).toHaveLength(17)
    for (const tablo of TABLOLAR) {
      expect(TUM_SQL, tablo).toMatch(
        new RegExp(`CREATE TABLE(?: IF NOT EXISTS)? public\\.${tablo}\\s*\\(`),
      )
    }
    // Dört tablonun doğal anahtarı vardır: oturum, ayar, hız sınırı ve Discord bağlantısı.
    const dogalAnahtarli = [
      'admin_sessions',
      'app_settings',
      'rate_limits',
      'discord_links',
    ] as const
    expect((TUM_SQL.match(/gen_random_uuid\(\)/g) ?? []).length).toBeGreaterThanOrEqual(
      TABLOLAR.length - dogalAnahtarli.length,
    )
  })

  it('zaman damgaları timestamptz ve varsayılan now() kullanır', () => {
    expect(TUM_SQL).toContain('created_at timestamptz NOT NULL DEFAULT now()')
    expect(TUM_SQL).toContain('updated_at timestamptz NOT NULL DEFAULT now()')
  })
})

describe('soru ve başvuru kısıtları', () => {
  it('question_type CHECK listesi tam olarak yedi tipi içerir', () => {
    const eslesme = SEMA.match(
      /question_type\s+text\s+NOT\s+NULL\s+CHECK\s*\(question_type\s+IN\s*\(([^)]*)\)\)/i,
    )
    expect(eslesme).not.toBeNull()
    const tipler = (eslesme?.[1] ?? '')
      .split(',')
      .map((parca) => parca.trim().replace(/^'|'$/g, ''))
    expect(tipler).toEqual([...SORU_TIPLERI])
  })

  it('başvuru durumu ve bildirim durumu CHECK ile sınırlı', () => {
    expect(SEMA).toMatch(/status IN \('pending','reviewing','accepted','rejected'\)/)
    expect(SEMA).toMatch(/status IN \('pending','sent','failed'\)/)
  })

  it('başvuru yaş, saat ve kullanıcı adı açısından güvenli', () => {
    expect(SEMA).toContain('age >= 16 AND age <= 99')
    expect(SEMA).not.toContain('age >= 10 AND age <= 120')
    expect(TOHUM).toContain('Yaşın 16 ile 99 arasında olmalıdır.')
    expect(TOHUM).toMatch(/'Yaşın kaç\?'.{0,120}16, 99/s)
    expect(SEMA).toContain('daily_hours >= 0 AND daily_hours <= 24')
    expect(SEMA).toContain("'^[A-Za-z0-9_]{3,32}$'")
    expect(SEMA).toContain("'^[A-Za-z0-9_.]{3,32}$'")
  })

  it('ham sorgu anahtarı saklanmaz, yalnızca sha256 özeti tutulur', () => {
    expect(SEMA).toContain('query_token_hash text NOT NULL')
    expect(SEMA).not.toMatch(/^\s*query_token\s+text\s/m)
    expect(RLS).toContain('encode(sha256(convert_to(p_query_token, \'UTF8\')), \'hex\')')
  })

  it('eski cevaplar için question_id alanında FK yok', () => {
    const cevapBlok = SEMA.slice(
      SEMA.indexOf('CREATE TABLE IF NOT EXISTS public.application_answers'),
      SEMA.indexOf('CREATE TABLE IF NOT EXISTS public.application_scores'),
    )
    expect(cevapBlok).toContain('question_id uuid NOT NULL')
    expect(cevapBlok).not.toContain('REFERENCES public.questions')
    expect(cevapBlok).toContain('options_snapshot jsonb')
    expect(SEMA).toContain('Eski başvuruların cevaplarını korumak')
  })

  it('benzersizlik ve denetim kısıtları mevcut', () => {
    expect(SEMA).toContain('UNIQUE (application_id, criterion_key)')
    expect(SEMA).toContain('admins_username_lower_unique ON public.admins (lower(username))')
    expect(SEMA).toContain('token_hash text PRIMARY KEY')
  })
})

describe('satır düzeyi güvenlik', () => {
  it('tüm tablolar için RLS etkin', () => {
    for (const tablo of TABLOLAR) {
      expect(RLS, tablo).toContain(`ALTER TABLE public.${tablo} ENABLE ROW LEVEL SECURITY;`)
    }
  })

  it('herkese açık okuma yalnızca etkin kayıtlarla sınırlı', () => {
    expect(RLS).toContain('ON public.positions FOR SELECT TO anon, authenticated')
    expect(RLS).toContain('ON public.question_categories FOR SELECT TO anon, authenticated')
    expect(RLS).toContain('ON public.questions FOR SELECT TO anon, authenticated')
    expect(RLS).toContain('ON public.question_options FOR SELECT TO anon, authenticated')
    expect(RLS).toContain('ON public.score_criteria FOR SELECT TO anon, authenticated')
    expect(RLS).toMatch(/is_active = true[\s\S]{0,200}SELECT 1 FROM public\.questions/)
  })

  it('yönetim tabloları için açık reddetme ilkeleri var', () => {
    const reddetmeSayisi = (RLS.match(/USING \(false\) WITH CHECK \(false\)/g) ?? []).length
    expect(reddetmeSayisi).toBeGreaterThanOrEqual(12)
    expect(RLS).not.toMatch(/GRANT (ALL|INSERT|UPDATE|DELETE) ON public\.\w+ TO anon/i)
    expect(RLS).toContain('GRANT SELECT ON public.positions')
  })

  it('güvenli başvuru sorgulama işlevi SECURITY DEFINER ve anonime açık', () => {
    expect(RLS).toMatch(/CREATE OR REPLACE FUNCTION public\.lookup_application/)
    expect(RLS).toContain('SECURITY DEFINER')
    expect(RLS).toContain('SET search_path = public, pg_temp')
    expect(RLS).toContain('GRANT EXECUTE ON FUNCTION public.lookup_application(text, text) TO anon')
    for (const alan of [
      'tracking_no',
      'position_slug',
      'status',
      'submitted_at',
      'decided_at',
      'notification_status',
      'status_history',
    ]) {
      expect(RLS, alan).toContain(`${alan} `)
    }
  })

  it('herkese açık soru işlevi mevcut ve anonime açık', () => {
    expect(RLS).toMatch(/CREATE OR REPLACE FUNCTION public\.get_public_questions/)
    expect(RLS).toContain('GRANT EXECUTE ON FUNCTION public.get_public_questions(text) TO anon')
  })

  it('frontend kaynak kodunda service_role kullanımı yok', () => {
    const dosyalar = kaynakDosyalari(join(kok, 'src'))
    expect(dosyalar.length).toBeGreaterThan(0)
    for (const dosya of dosyalar) {
      const kod = yorumlariKaldir(readFileSync(dosya, 'utf8'))
      expect(kod.toLowerCase(), dosya).not.toContain('service_role')
      expect(kod, dosya).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
    }
    // Yorumlarda geçen ifadeler yalnızca "asla eklenmez" uyarısıdır.
    const yorumlu = dosyalar.filter((dosya) => readFileSync(dosya, 'utf8').includes('service_role'))
    for (const dosya of yorumlu) {
      const icerik = readFileSync(dosya, 'utf8')
      expect(icerik, dosya).toMatch(/asla|eklenmez/i)
    }
  })
})

describe('tetikleyiciler, fonksiyonlar ve dizinler', () => {
  it('gerekli tüm fonksiyonlar tanımlı', () => {
    for (const fonksiyon of [
      'set_updated_at',
      'log_application_status_change',
      'check_score_total',
      'generate_tracking_no',
      'cleanup_expired_sessions',
      'cleanup_old_rate_limits',
    ]) {
      expect(TETIKLEYICI, fonksiyon).toContain(`FUNCTION public.${fonksiyon}`)
    }
  })

  it('denetim günlüğü salt okunur (append-only)', () => {
    expect(TETIKLEYICI).toContain('BEFORE UPDATE OR DELETE ON public.audit_logs')
    expect(TETIKLEYICI).toContain('BEFORE TRUNCATE ON public.audit_logs')
    expect(TETIKLEYICI).toContain('RAISE EXCEPTION')
  })

  it('durum değişikliği geçmiş ve denetim kaydı yazar', () => {
    expect(TETIKLEYICI).toContain('INSERT INTO public.application_history')
    expect(TETIKLEYICI).toContain('INSERT INTO public.audit_logs')
    expect(TETIKLEYICI).toContain('AFTER UPDATE OF status ON public.applications')
  })

  it('ağırlık toplamı ve başvuru puanı kontrolleri var', () => {
    expect(TETIKLEYICI).toContain('v_toplam <> 100')
    expect(TETIKLEYICI).toContain('NEW.points > NEW.weight_snapshot')
  })

  it('gerekli dizinler mevcut', () => {
    for (const dizin of [
      'ON public.applications (status, submitted_at)',
      'ON public.application_answers (application_id)',
      'ON public.audit_logs (created_at)',
      'ON public.questions (position_slug, is_active, sort_order)',
      'ON public.rate_limits (key)',
    ]) {
      expect(TETIKLEYICI, dizin).toContain(dizin)
    }
  })
})

describe('tohum verisi', () => {
  it('iki pozisyon ve beş kategori doğru adlarla eklenmiş', () => {
    expect(TOHUM).toContain("('rehber', 'Rehber'")
    expect(TOHUM).toContain("('aac', 'AAC'")
    for (const [slug, ad] of KATEGORILER) {
      expect(TOHUM, slug).toMatch(new RegExp(`'${slug}',\\s*'${ad}'`))
    }
  })

  it('altı puanlama ölçütü doğru anahtar, ad ve ağırlıkla eklenmiş', () => {
    for (const [anahtar, ad, agirlik] of OLCUTLER) {
      expect(TOHUM, anahtar).toMatch(new RegExp(`\\('${anahtar}',\\s*'${ad}',\\s*${agirlik},`))
    }
  })

  it('ölçüt ağırlıklarının toplamı 100', () => {
    const baslangic = TOHUM.indexOf('INSERT INTO public.score_criteria')
    const bitis = TOHUM.indexOf('-- Başlangıç soruları')
    const blok = TOHUM.slice(baslangic, bitis)
    const agirliklar = Array.from(blok.matchAll(/'([a-z_]+)',\s*'[^']+',\s*(\d+),/g)).map(
      (eslesme) => Number(eslesme[2]),
    )
    expect(agirliklar).toHaveLength(6)
    expect(agirliklar.reduce((toplam, deger) => toplam + deger, 0)).toBe(100)
  })

  it('yedi soru tipinin tamamı ve her iki pozisyon kullanılmış', () => {
    for (const tip of SORU_TIPLERI) {
      expect(TOHUM, tip).toContain(`'${tip}'`)
    }
    expect(TOHUM).toContain("'rehber',")
    expect(TOHUM).toContain("'aac',")
    expect((TOHUM.match(/'10000000-0000-4000-8000-/g) ?? []).length).toBeGreaterThanOrEqual(12)
  })

  it('uygulama ayarlarının varsayılanları doğru', () => {
    for (const anahtar of [
      'site_title',
      'applications_open',
      'closed_message',
      'discord_enabled',
      'min_minecraft_age_months',
      'rate_limit_per_ip_per_hour',
    ]) {
      expect(TOHUM, anahtar).toContain(`('${anahtar}'`)
    }
    expect(TOHUM).toContain("('applications_open', 'true'::jsonb)")
    expect(TOHUM).toContain("('discord_enabled', 'false'::jsonb)")
    expect(TOHUM).toContain("('rate_limit_per_ip_per_hour', '5'::jsonb)")
  })

  it('tüm tohum eklemeleri yinelemeye dayanıklı', () => {
    const conflictSayisi = (TOHUM.match(/ON CONFLICT [^\n]*DO NOTHING/g) ?? []).length
    expect(conflictSayisi).toBeGreaterThanOrEqual(6)
  })
})

describe('ilk yönetici komut satırı aracı', () => {
  it('parola özeti biçimi ve yineleme sayısı CLI ve dokümanda geçiyor', () => {
    const cliDock = CLI.slice(0, CLI.indexOf('import '))
    expect(cliDock).toContain('pbkdf2$210000$')
    expect(cliDock).toContain('210000')
    expect(SEMA).toContain('pbkdf2$210000$')
    expect(SEMA).toContain('210000')
    expect(CLI).toContain('const ITERASYON = 210000')
    expect(CLI).toContain('const ANAHTAR_UZUNLUGU = 32')
    expect(CLI).toContain('const TUZ_UZUNLUGU = 16')
    expect(CLI).toContain('OZET_ALGORITMASI = \'sha256\'')
    expect(CLI).toMatch(/pbkdf2Sync\(\s*parola,\s*tuz,\s*ITERASYON,\s*ANAHTAR_UZUNLUGU,\s*OZET_ALGORITMASI\s*\)/)
  })

  it('gerekli ortam değişkenlerini okuyor ve parolayı doğruluyor', () => {
    for (const degisken of [
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'ADMIN_USERNAME',
      'ADMIN_PASSWORD',
      'ALLOW_REPLACE_ADMIN',
      'SETUP_TOKEN',
    ]) {
      expect(CLI, degisken).toContain(degisken)
    }
    expect(CLI).toContain('parola.length < 12')
    expect(CLI).toContain('en az 12 karakter olmalıdır')
  })

  it('REST uç noktalarını ve başlıkları doğru kullanıyor', () => {
    expect(CLI).toContain('/rest/v1/admins?select=id&limit=1')
    expect(CLI).toContain('apikey:')
    expect(CLI).toContain('Bearer ${servisAnahtari}')
    expect(CLI).toContain('return=minimal')
    expect(CLI).toContain('method: \'POST\'')
    expect(CLI).toContain('method: \'DELETE\'')
  })

  it('değiştirme modunda önce yeni yöneticiyi doğrular, sonra siler', () => {
    const olusturma = CLI.indexOf("body: JSON.stringify({ username: kullaniciAdi, password_hash: parolaOzeti })")
    const dogrulama = CLI.indexOf('yeniYoneticiDogru(dogrulanan, kullaniciAdi, parolaOzeti)')
    const silme = CLI.indexOf("method: 'DELETE'")
    expect(olusturma).toBeGreaterThanOrEqual(0)
    expect(dogrulama).toBeGreaterThan(olusturma)
    expect(silme).toBeGreaterThan(dogrulama)
    expect(CLI).toContain('id=neq.${olusturulan.id}')
    expect(CLI).toMatch(/en az bir aktif yönetici/i)
    expect(CLI).not.toContain('NIL_UUID')
  })

  it('sırları diske veya günlüğe yazmıyor', () => {
    expect(CLI).not.toMatch(/writeFile(?:Sync)?\(/)
    expect(CLI).not.toMatch(/appendFile(?:Sync)?\(/)
    expect(CLI).not.toContain('console.log(parola')
    expect(CLI).not.toContain('console.log(servisAnahtari')
    expect(CLI).not.toContain('console.log(parolaOzeti')
  })
})

it('canlı veritabanı olmadan çalışan saf metin doğrulaması', () => {
  expect(TUM_SQL.length).toBeGreaterThan(1000)
  expect(TOHUM).toContain('ON CONFLICT')
  expect(RLS).toContain('SECURITY DEFINER')
  expect(CLI).toContain('pbkdf2$210000$')
})
