import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  signSessionToken,
  verifySessionToken,
} from '../supabase/functions/_shared/pure.ts'

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
const DISCORD_OAUTH = `${EDGE}/discord-oauth/index.ts`
const SUBMIT = `${EDGE}/submit-application/index.ts`
const APPLY_PAGE = 'src/pages/ApplyPage.tsx'
const PUBLIC_API = 'src/lib/api-public.ts'
const MIGRATION = 'supabase/migrations/0005_submit_atomic.sql'

const SECRET = 'task-c-test-secret'

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

describe('YA-05 — Discord bağlantısı başvuruya bağlanır', () => {
  it('imzalı belirteç pending ve bound aşamalarında doğrulanabilir', () => {
    const now = Math.floor(Date.now() / 1000)
    const pending = signSessionToken(
      { sub: 'client-nonce', exp: now + 600, nonce: 'discord-link:pending:abc' },
      SECRET,
    )
    const bound = signSessionToken(
      { sub: '123456789012345678', exp: now + 3600, nonce: 'discord-link:bound:def' },
      SECRET,
    )

    expect(verifySessionToken(pending, SECRET)?.nonce).toContain('discord-link:pending:')
    expect(verifySessionToken(bound, SECRET)?.sub).toBe('123456789012345678')
    expect(verifySessionToken(bound, SECRET, now + 4000)).toBeNull()
    expect(verifySessionToken(pending, 'baska-sır')).toBeNull()
  })

  it('OAuth başlangıcı yalnızca imzalı belirteci kabul eder, application_id almaz', () => {
    const oauth = kod(DISCORD_OAUTH)
    expect(oauth).toContain('signSessionToken')
    expect(oauth).toContain('verifySessionToken')
    expect(oauth).toContain("verifyLinkToken(url.searchParams.get('discord_link_token'), 'pending', secret)")
    expect(oauth).toContain("requireAdmin(req, { csrf: false })")
    expect(oauth).not.toContain("url.searchParams.get('application_id')")
    expect(oauth).not.toContain('const applicationId = applicationIdFrom(')
  })

  it('callback Discord kimliğini yeni belirtece bağlayıp geri döndürür', () => {
    const oauth = kod(DISCORD_OAUTH)
    expect(oauth).toContain('createLinkToken(discordUserId, \'bound\', secret)')
    expect(oauth).toContain("destination.searchParams.set('discord_link_token', boundToken)")
    expect(oauth).toContain('DISCORD_ID_PATTERN.test(String(user.id))')
    expect(oauth).toContain('clearedLinkCookie()')
  })

  it('başvuru formu belirteci OAuth URL ve gönderim gövdesine taşır', () => {
    const page = kod(APPLY_PAGE)
    expect(page).toContain('requestDiscordLinkToken')
    expect(page).toContain('getDiscordOAuthUrl(withBasePath(location.pathname), token)')
    expect(page).toContain("params.get('discord_link_token')")
    expect(page).toContain('discord_link_token: discordLinkToken')

    const api = kod(PUBLIC_API)
    expect(api).toContain('export async function requestDiscordLinkToken()')
    expect(api).toContain("params.set('discord_link_token', discordLinkToken)")
  })

  it('gönderim belirteci doğrular ve Discord alanlarını atomik RPC ile yazar', () => {
    const submit = kod(SUBMIT)
    expect(submit).toContain('verifySessionToken(token, secret)')
    expect(submit).toContain("payload.nonce.startsWith('discord-link:bound:')")
    expect(submit).toContain('/^\\d{5,25}$/.test(payload.sub)')
    expect(submit).toContain('p_discord_user_id: discordLink?.userId ?? null')
    expect(submit).toContain('p_discord_username: discordLink?.username ?? null')
    expect(submit).not.toMatch(/discord_connected:\s*true/)
  })
})

describe('YA-10 / YA-11 — atomik yazım ve sayıç', () => {
  it('göç başvuru, cevap ve Discord bağlantısını tek fonksiyonda yazar', () => {
    const sql = kaynak(MIGRATION)
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.submit_application_atomic(')
    expect(sql).toContain('INSERT INTO public.applications (')
    expect(sql).toContain('INSERT INTO public.application_answers (')
    expect(sql).toContain('INSERT INTO public.discord_links (')
    expect(sql).toContain('application_id = EXCLUDED.application_id')
    expect(sql).toContain('SECURITY DEFINER')
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.submit_application_atomic/)
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
