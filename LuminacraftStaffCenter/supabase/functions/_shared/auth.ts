// Oturum, CSRF ve PBKDF2 şifre doğrulama yardımcıları.
import { getAdminClient } from './db.ts'
import { error, defaultMessage } from './responses.ts'
import {
  bytesToHex,
  env,
  isActiveSession,
  parsePasswordHash,
  PASSWORD_ITERATIONS,
  PASSWORD_KEY_BYTES,
  PASSWORD_SALT_BYTES,
  sessionTokenHash,
  signSessionToken,
  timingSafeEqualHex,
  verifySessionToken,
} from './pure.ts'

// Saf yardımcılar pure.ts'te bulunur; Edge Function'lar buradan da içe aktarabilir.
export {
  clientIp,
  INVALID_CREDENTIALS_MESSAGE,
  isActiveSession,
  isLoginLocked,
  LOGIN_LOCKED_MESSAGE,
  LOGIN_MAX_ATTEMPTS,
  LOGIN_WINDOW_MS,
  loginRateLimitKey,
  loginWindowStart,
  sessionTokenHash,
  type AdminSessionRow,
} from './pure.ts'

export const SESSION_COOKIE = 'lsc_admin_session'
export const CSRF_COOKIE = 'lsc_csrf'
export const SESSION_MAX_AGE = 28800

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

export function getSessionSecret(): string | null {
  return env('SESSION_SECRET') ?? null
}

/** PBKDF2-SHA256 ile saklanan karma doğrulanır (210000 tur, 32 bayt anahtar). */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parsed = parsePasswordHash(storedHash)
  if (!parsed || typeof password !== 'string') return false
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return false
  try {
    const key = await subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits'],
    )
    const bits = await subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: parsed.salt as BufferSource,
        iterations: PASSWORD_ITERATIONS,
        hash: 'SHA-256',
      },
      key,
      PASSWORD_KEY_BYTES * 8,
    )
    return timingSafeEqualHex(bytesToHex(new Uint8Array(bits)), bytesToHex(parsed.hash))
  } catch {
    return false
  }
}

/** Yönetici oluşturma için karma üretir; biçim `pbkdf2$210000$...`. */
export async function hashPassword(password: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('Şifre karma alma işlemi kullanılamıyor.')
  const salt = randomBytes(PASSWORD_SALT_BYTES)
  const key = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PASSWORD_ITERATIONS, hash: 'SHA-256' },
    key,
    PASSWORD_KEY_BYTES * 8,
  )
  return `pbkdf2$${PASSWORD_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(new Uint8Array(bits))}`
}

export function createSessionToken(adminId: string): string {
  const secret = getSessionSecret()
  if (!secret) throw new Error('Oturum sırrı yapılandırılmamış.')
  return signSessionToken(
    {
      sub: adminId,
      exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
      nonce: bytesToHex(randomBytes(16)),
    },
    secret,
  )
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${SESSION_MAX_AGE}`
}

export function csrfCookie(token: string): string {
  return `${CSRF_COOKIE}=${token}; Path=/; Secure; SameSite=None`
}

export function clearedSessionCookies(): string[] {
  return [
    `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0`,
    `${CSRF_COOKIE}=; Path=/; Secure; SameSite=None; Max-Age=0`,
  ]
}

export function newCsrfToken(): string {
  return bytesToHex(randomBytes(16))
}

export function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie')
  if (!raw) return null
  for (const part of raw.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim())
      } catch {
        return part.slice(index + 1).trim()
      }
    }
  }
  return null
}

/** Çift gönderim CSRF: başlık ile okunabilir çerez bire bir eşleşmeli. */
export function requireCsrf(req: Request): boolean {
  const header = req.headers.get('x-csrf-token')
  const cookie = readCookie(req, CSRF_COOKIE)
  return Boolean(header && cookie && timingSafeEqualHex(header, cookie))
}

export interface AdminContext {
  adminId: string
}

export type AdminAuthResult =
  | ({ ok: true } & AdminContext)
  | { ok: false; response: Response }

/** Oturumu (ve isteğe bağlı CSRF) doğrular; yönetici kaydı aktif olmalı. */
export async function requireAdmin(
  req: Request,
  options: { csrf?: boolean } = {},
): Promise<AdminAuthResult> {
  const secret = getSessionSecret()
  if (!secret) {
    return {
      ok: false,
      response: error(
        'Oturum sistemi yapılandırılmamış: SESSION_SECRET tanımlanmalı.',
        503,
        'configuration',
      ),
    }
  }
  const token = readCookie(req, SESSION_COOKIE)
  if (!token) return { ok: false, response: error(defaultMessage(401), 401, 'unauthorized') }
  const payload = verifySessionToken(token, secret)
  if (!payload) return { ok: false, response: error(defaultMessage(401), 401, 'unauthorized') }
  if (options.csrf && !requireCsrf(req)) {
    return { ok: false, response: error('CSRF doğrulaması başarısız.', 403, 'csrf') }
  }

  const db = await getAdminClient()
  if (!db.ok) return { ok: false, response: error(db.error, 503, 'configuration') }
  try {
    // Ham belirtecin sha256 özetiyle oturum kaydı aranır; iptal/süre kontrolü
    // yalnızca imzaya güvenmek yerine veritabanında da yapılır.
    const { data: session, error: sessionError } = await db.client
      .from('admin_sessions')
      .select('admin_id, expires_at, revoked_at')
      .eq('token_hash', sessionTokenHash(token))
      .maybeSingle()
    if (sessionError) return { ok: false, response: error(defaultMessage(500), 500, 'database') }
    if (!isActiveSession(session as AdminSessionRow | null, payload.sub)) {
      return { ok: false, response: error(defaultMessage(401), 401, 'unauthorized') }
    }

    const { data, error: dbError } = await db.client
      .from('admins')
      .select('id, is_active')
      .eq('id', payload.sub)
      .maybeSingle()
    if (dbError) return { ok: false, response: error(defaultMessage(500), 500, 'database') }
    if (!data || data.is_active === false) {
      return { ok: false, response: error(defaultMessage(401), 401, 'unauthorized') }
    }
    return { ok: true, adminId: payload.sub }
  } catch {
    return { ok: false, response: error(defaultMessage(500), 500, 'database') }
  }
}
