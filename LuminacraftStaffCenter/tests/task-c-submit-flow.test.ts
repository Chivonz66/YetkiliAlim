import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Görev C sözleşmesi: kaynak metin + saf imza yardımcılarıyla, canlı Supabase
 * olmadan doğrulanır. t1/t2'nin dosyalarına bağımlı değildir.
 */
function projeKokunuBul(): string {
  let dizin = process.cwd()
  for (let adim = 0; adim < 5; adim += 1) {
    if (existsSync(join(dizin, 'supabase/migrations/0001_initial_schema.sql'))) return dizin
    const ust = join(dizin, '..')
    if (ust === dizin) break
    dizin = ust
  }
  throw new Error('Luminacraft Staff Center proje kökü bulunamadı.')
}

const kok = projeKokunuBul()
const kaynak = (goreliYol: string): string => readFileSync(join(kok, goreliYol), 'utf8')
const kod = (goreliYol: string): string =>
  kaynak(goreliYol).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const EDGE = 'supabase/functions'
const ADMIN_POSITIONS = `${EDGE}/admin-positions/index.ts`
const SUBMIT = `${EDGE}/submit-application/index.ts`
const APPLY_PAGE = 'src/pages/ApplyPage.tsx'
const PUBLIC_API = 'src/lib/api-public.ts'
const MIGRATION = 'supabase/migrations/0005_submit_atomic.sql'
const REMOVAL_MIGRATION = 'supabase/migrations/0009_remove_discord_integrations.sql'

describe('YA-04 — pozisyon açıklığı tek kaynaktan okunur', () => {
  it('yönetici is_open değerini app_settings anahtarına yazar ve geri yansıtır', () => {
    const admin = kod(ADMIN_POSITIONS)
    expect(admin).toContain('return `${slug}_applications_open`')
    expect(admin).toContain("from('app_settings').upsert")
    expect(admin).toContain('key: applicationOpenKey(slug)')
    expect(admin).toContain('value: isOpen')
    expect(admin).toContain('is_open: openFlags[String(position.slug)] ?? true')
    expect(admin).toContain("requireAdmin(req, { csrf: method !== 'GET' })")
  })

  it('genel API ve gönderim aynı kanonik anahtarı kullanır', () => {
    const api = kod(PUBLIC_API)
    const submit = kod(SUBMIT)
    expect(api).toContain('return `${slug}_applications_open`')
    expect(api).not.toContain('${slug}_is_open')
    expect(api).not.toContain('${slug}_open`')
    expect(submit).toContain('${data.position_slug}_applications_open')
    expect(submit).toContain("'position_closed'")
  })
})

describe('YA-05 — Discord kullanıcı adı zorunlu, hesap bağlama yok', () => {
  it('başvuru formu Discord kullanıcı adını zorunlu ve biçimli ister', () => {
    const page = kod(APPLY_PAGE)
    expect(page).toContain('Discord kullanıcı adı zorunludur;')
    expect(page).toContain('/^[A-Za-z0-9_.]{3,32}$/.test(discord)')
    expect(page).not.toMatch(
      /discord_link_token|requestDiscordLinkToken|getDiscordOAuthUrl|discordLinked|oauthHref|discord_linked/i,
    )
  })

  it('ortak API bağlantı belirteci veya bildirim durumu taşımaz', () => {
    const api = kod(PUBLIC_API)
    expect(api).not.toMatch(/discord_link_token|requestDiscordLinkToken|getDiscordOAuthUrl/i)
    expect(api).not.toMatch(/discord_notification|discord_notified|notification_status/)
  })

  it('sunucu Discord kullanıcı adını doğrular ve bağlantı belirteci kabul etmez', () => {
    const submit = kod(SUBMIT)
    const validation = kod('supabase/functions/_shared/validation.ts')
    expect(validation).toContain('Discord kullanıcı adı zorunludur.')
    expect(validation).toContain('/^[A-Za-z0-9_.]{3,32}$/')
    expect(submit).toContain('applicant_discord_username: discord')
    expect(submit).toContain("rpc('submit_application_atomic'")
    expect(submit).not.toMatch(/verifySessionToken|discord_link_token|discordLink|discord-link:/i)
    expect(submit).not.toContain('p_discord_user_id')
  })
})

describe('YA-10 / YA-11 — atomik yazım ve sayaç', () => {
  it('göç başvuru ve cevapları tek fonksiyonda yazar', () => {
    const sql = kaynak(MIGRATION)
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.submit_application_atomic(')
    expect(sql).toContain('p_application jsonb,')
    expect(sql).toContain('p_answers jsonb')
    expect(sql).toContain('INSERT INTO public.applications (')
    expect(sql).toContain('INSERT INTO public.application_answers (')
    expect(sql).toContain('applicant_discord_username,')
    expect(sql).toContain('SECURITY DEFINER')
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.submit_application_atomic/)
    expect(sql).not.toContain('discord_links')
    expect(sql).not.toContain('notification_queue')
  })

  it('0009 eski Discord/DM veritabanı nesnelerini kaldırır ve RPC’yi sadeleştirir', () => {
    const sql = kaynak(REMOVAL_MIGRATION)
    expect(sql).toContain('DROP TABLE IF EXISTS public.discord_links')
    expect(sql).toContain('DROP TABLE IF EXISTS public.notification_queue')
    expect(sql).toContain('DROP COLUMN IF EXISTS notification_status')
    expect(sql).toContain('submit_application_atomic(jsonb, jsonb, text, text, text)')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.submit_application_atomic(')
    expect(sql).not.toMatch(/INSERT INTO public\.(discord_links|notification_queue)/)
  })

  it('hız sınırı UPSERT ... RETURNING ile atomik artırılır', () => {
    const sql = kaynak(MIGRATION)
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.increment_rate_limit(')
    expect(sql).toContain('INSERT INTO public.rate_limits (key, window_start, hit_count)')
    expect(sql).toContain('ON CONFLICT (key, window_start)')
    expect(sql).toContain('DO UPDATE SET hit_count = public.rate_limits.hit_count + 1')
    expect(sql).toContain('RETURNING hit_count INTO v_hit_count')
    const submit = kod(SUBMIT)
    expect(submit).toContain("rpc('increment_rate_limit'")
    expect(submit).not.toContain(".from('rate_limits')")
  })
})

describe('YA-15 / YA-07 — sunucu seçenekleri ve yaş aralığı', () => {
  it('etkin seçenek yoksa çoklu/tek seçim cevabı reddedilir', () => {
    const submit = kod(SUBMIT)
    expect(submit).toContain(
      'return values.length > 0 && typeof answer === \'string\' && values.includes(answer)',
    )
    expect(submit).toContain('values.length > 0 &&')
    expect(submit).not.toMatch(/values\.length === 0 \|\|/)
  })

  it('başvuru formu yaş sınırı 16–99 olarak kalır', () => {
    const page = kod(APPLY_PAGE)
    expect(page).toContain('minLength: 16, maxLength: 99')
    expect(page).toContain('min={16}')
    expect(page).toContain('max={99}')
    expect(page).toContain('16 ile 99 arasında olmalıdır')
  })
})
