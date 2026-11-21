import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  INVALID_CREDENTIALS_MESSAGE,
  isActiveSession,
  isLoginLocked,
  isValidAge,
  isValidSetupPassword,
  isValidSetupUsername,
  LOGIN_LOCKED_MESSAGE,
  LOGIN_MAX_ATTEMPTS,
  loginRateLimitKey,
  loginWindowStart,
  sessionTokenHash,
  sha256Hex,
  type AdminSessionRow,
} from '../supabase/functions/_shared/pure.ts'
import { validate } from '../supabase/functions/_shared/validation.ts'

// Canlı DB, ağ veya Deno gerekmez: kaynak metin + saf yardımcılar.
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
function existsSync(yol: string): boolean {
  try {
    readFileSync(yol)
    return true
  } catch {
    return false
  }
}

const kok = projeKokunuBul()
const oku = (goreliYol: string): string => readFileSync(join(kok, goreliYol), 'utf8')
const AUTH_INDEX = oku('supabase/functions/admin-auth/index.ts')
const AUTH_SHARED = oku('supabase/functions/_shared/auth.ts')
const CLI = oku('scripts/create-first-admin.mjs')
const SEMA = oku('supabase/migrations/0001_initial_schema.sql')
const TOHUM = oku('supabase/migrations/0004_seed_data.sql')
const HOME = oku('src/pages/HomePage.tsx')
const VALIDATION = oku('supabase/functions/_shared/validation.ts')

describe('Edge Zod yükleyici', () => {
  it('CDN modülü statik import ile gömülür', () => {
    expect(VALIDATION).toContain("import(/* @vite-ignore */ 'https://esm.sh/zod@3')")
    expect(VALIDATION).not.toContain("['https://esm.sh', 'zod@3'].join('/')")
    expect(VALIDATION).toContain("'Deno' in globalThis")
  })
})

describe('YA-01: kurulum yüzeyi ve katı şema', () => {
  it('setup sır ile korunur, setup-status herkese açık kalır', () => {
    expect(AUTH_INDEX).toContain("action === 'setup-status'")
    expect(AUTH_INDEX).toContain("action === 'setup'")
    expect(AUTH_INDEX).toContain('hasSetupSecret(req)')
    expect(AUTH_INDEX).toContain("env('ADMIN_SETUP_SECRET')")
    expect(AUTH_INDEX).toContain("x-admin-setup-secret")
    expect(AUTH_INDEX).not.toContain("validate<SetupData>('login', body)")
    expect(AUTH_INDEX).toContain("validate<SetupData>('setup', body)")
  })

  it('admin varlığı kontrolü ve ekleme atomik RPC ile yapılır', () => {
    expect(AUTH_INDEX).toContain("rpc('create_first_admin'")
    expect(AUTH_INDEX).toContain('p_password_hash: passwordHash')
    expect(SEMA).toContain('CREATE OR REPLACE FUNCTION public.create_first_admin')
    expect(SEMA).toContain('pg_advisory_xact_lock')
    expect(SEMA).toContain('IF EXISTS (SELECT 1 FROM public.admins)')
    expect(SEMA).toContain('REVOKE ALL ON FUNCTION public.create_first_admin(text, text) FROM PUBLIC')
    expect(SEMA).toContain('GRANT EXECUTE ON FUNCTION public.create_first_admin(text, text) TO service_role')
  })

  it('setup şeması zayıf kimlik bilgilerini reddeder', async () => {
    expect(isValidSetupUsername('ab')).toBe(false)
    expect(isValidSetupUsername('admin')).toBe(true)
    expect(isValidSetupUsername('bad name')).toBe(false)
    expect(isValidSetupPassword('short')).toBe(false)
    expect(isValidSetupPassword('a'.repeat(12))).toBe(true)

    const weak = await validate('setup', { username: 'ab', password: 'short' })
    expect(weak.ok).toBe(false)
    if (!weak.ok) {
      expect(weak.error).toMatch(/kullanıcı adı|parola/i)
    }
    const shortUsername = await validate('setup', { username: 'ab', password: 'a'.repeat(12) })
    expect(shortUsername.ok).toBe(false)
    const shortPassword = await validate('setup', { username: 'admin', password: 'short' })
    expect(shortPassword.ok).toBe(false)
    const valid = await validate('setup', { username: 'admin-01', password: 'a'.repeat(12) })
    expect(valid.ok).toBe(true)
  })
})

describe('YA-02: giriş kilidi', () => {
  it('eşik beş başarısız denemedir ve anahtar IP+kullanıcı adına bağlıdır', () => {
    expect(LOGIN_MAX_ATTEMPTS).toBe(5)
    expect(isLoginLocked(LOGIN_MAX_ATTEMPTS - 1)).toBe(false)
    expect(isLoginLocked(LOGIN_MAX_ATTEMPTS)).toBe(true)
    expect(isLoginLocked(undefined)).toBe(false)

    const ip = '203.0.113.10'
    const key = loginRateLimitKey(ip, 'Admin')
    expect(key).toBe(loginRateLimitKey(ip, 'admin'))
    expect(key).not.toBe(loginRateLimitKey('203.0.113.11', 'admin'))
    expect(key).not.toBe(loginRateLimitKey(ip, 'other'))
    expect(key).toContain(sha256Hex(`${ip}|admin`))
    expect(key).not.toContain('Admin')
    expect(loginWindowStart(new Date('2026-11-21T10:07:00.000Z'))).toBe(
      '2026-11-21T10:00:00.000Z',
    )
  })

  it('admin-auth rate_limits tablosunu kullanır ve genel hata mesajını korur', () => {
    expect(AUTH_INDEX).toContain("from('rate_limits')")
    expect(AUTH_INDEX).toContain('loginRateLimitKey(clientIp(req), checked.data.username)')
    expect(AUTH_INDEX).toContain('isLoginLocked(attempts?.hit_count)')
    expect(AUTH_INDEX).toContain('recordFailedLogin(client, limitKey, windowStart)')
    expect(AUTH_INDEX).toContain('onConflict: \'key,window_start\'')
    expect(INVALID_CREDENTIALS_MESSAGE).toBe('Kullanıcı adı veya şifre hatalı.')
    expect(LOGIN_LOCKED_MESSAGE.length).toBeGreaterThan(10)
    expect(AUTH_INDEX).toContain('INVALID_CREDENTIALS_MESSAGE')
    expect(AUTH_INDEX).toContain('LOGIN_LOCKED_MESSAGE')
  })
})

describe('YA-03: oturum iptali', () => {
  const active: AdminSessionRow = {
    admin_id: 'admin-1',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    revoked_at: null,
  }

  it('iptal edilen, süresi dolan veya sahip olunmayan oturum reddedilir', () => {
    expect(isActiveSession(active, 'admin-1')).toBe(true)
    expect(
      isActiveSession({ ...active, revoked_at: new Date().toISOString() }, 'admin-1'),
    ).toBe(false)
    expect(
      isActiveSession({ ...active, expires_at: new Date(Date.now() - 1).toISOString() }, 'admin-1'),
    ).toBe(false)
    expect(isActiveSession(active, 'admin-2')).toBe(false)
    expect(isActiveSession(null, 'admin-1')).toBe(false)
  })

  it('belirtecin sha256 özeti saklanır; çıkışta oturum iptal edilir', () => {
    expect(sessionTokenHash('ham-belirtec')).toBe(sha256Hex('ham-belirtec'))
    expect(AUTH_INDEX).toContain('token_hash: sessionTokenHash(token)')
    expect(AUTH_INDEX).toContain('expires_at: expiresAt')
    expect(AUTH_INDEX).toMatch(/\.from\('admin_sessions'\)\s*\.update\(\{\s*revoked_at:/s)
    expect(AUTH_SHARED).toContain("from('admin_sessions')")
    expect(AUTH_SHARED).toContain('revoked_at')
    expect(AUTH_SHARED).toContain('sessionTokenHash(token)')
  })
})

describe('YA-14: CLI değiştirme sırası', () => {
  it('doğrulama DELETE işleminden önce gelir', () => {
    const insert = CLI.indexOf('password_hash: parolaOzeti })')
    const verify = CLI.indexOf('Yeni yönetici doğrulanamadı; mevcut kayıtlar silinmedi.')
    const del = CLI.indexOf("method: 'DELETE'")
    expect(insert).toBeGreaterThanOrEqual(0)
    expect(verify).toBeGreaterThan(insert)
    expect(del).toBeGreaterThan(verify)
    expect(CLI).toContain('id=neq.${olusturulan.id}')
    expect(CLI).toContain('aktifYoneticiKaldi(')
  })
})

describe('YA-07: 16-99 yaş aralığı', () => {
  it('saf doğrulama sınırları 16 ve 99’dur', () => {
    expect(isValidAge(15)).toBe(false)
    expect(isValidAge(16)).toBe(true)
    expect(isValidAge(99)).toBe(true)
    expect(isValidAge(100)).toBe(false)
  })

  it('Zod başvuru şeması aynı sınırı uygular', async () => {
    const payload = {
      position_slug: 'rehber',
      applicant_minecraft_username: 'Steve_12',
      applicant_discord_username: 'player.name',
      age: 16,
      daily_hours: 2,
      answers: {},
      elapsed_ms: 3000,
    }
    expect((await validate('application', payload)).ok).toBe(true)
    expect((await validate('application', { ...payload, age: 15 })).ok).toBe(false)
    expect((await validate('application', { ...payload, age: 99 })).ok).toBe(true)
    const tooOld = await validate('application', { ...payload, age: 100 })
    expect(tooOld.ok).toBe(false)
    if (!tooOld.ok) expect(tooOld.error).toContain('16 ile 99')
  })

  it('şema, tohum ve ana sayfa metinleri tutarlıdır', () => {
    expect(SEMA).toContain('age >= 16 AND age <= 99')
    expect(TOHUM).toContain('Yaşın 16 ile 99 arasında olmalıdır.')
    expect(TOHUM).toContain('16, 99')
    expect(HOME).toContain('16–99')
    expect(HOME).not.toMatch(/en küçük yaş sınırı 16/)
  })
})
