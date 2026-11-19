// Discord OAuth2 bağlama akışı. Erişim belirteci yalnızca sunucuda kullanılır, asla günlüğe yazılmaz.
import { OAUTH_STATE_COOKIE, readCookie } from '../_shared/auth.ts'
import { preflight, withCors } from '../_shared/cors.ts'
import { getAdminClient } from '../_shared/db.ts'
import {
  bytesToHex,
  env,
  getAllowedOrigins,
  hmacSha256Hex,
  isSafeReturnTo,
  sha256Hex,
  timingSafeEqualHex,
} from '../_shared/pure.ts'
import { defaultMessage, error } from '../_shared/responses.ts'
import { readJson } from '../_shared/validation.ts'

const AUTHORIZE_URL = 'https://discord.com/oauth2/authorize'
const TOKEN_URL = 'https://discord.com/api/oauth2/token'
const USER_URL = 'https://discord.com/api/users/@me'
const STATE_MAX_AGE = 600
const RETURN_COOKIE = 'lsc_oauth_return'
const APP_COOKIE = 'lsc_oauth_app'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function cookieOptions(maxAge: number): string {
  return `HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${maxAge}`
}

function stateCookie(value: string): string {
  return `${OAUTH_STATE_COOKIE}=${value}; ${cookieOptions(STATE_MAX_AGE)}`
}

function clearedStateCookie(): string {
  return `${OAUTH_STATE_COOKIE}=; ${cookieOptions(0)}`
}

function clearedReturnCookie(): string {
  return `${RETURN_COOKIE}=; ${cookieOptions(0)}`
}

function clearedAppCookie(): string {
  return `${APP_COOKIE}=; ${cookieOptions(0)}`
}

/**
 *Durum değeri sunucu tarafından imzalanır: discord_links tablosunda oturum
 *öncesi satır oluşturulamaz (birincil anahtar discord_user_id'dir).
 */
function createState(secret: string): string {
  const nonce = bytesToHex(randomBytes(16))
  const expiresAt = String(Date.now() + STATE_MAX_AGE * 1000)
  const signature = hmacSha256Hex(`${nonce}.${expiresAt}`, secret)
  return `${nonce}.${expiresAt}.${signature}`
}

function verifyState(state: string | null, secret: string): boolean {
  if (!state) return false
  const parts = state.split('.')
  if (parts.length !== 3) return false
  const [nonce, expiresAt, signature] = parts
  if (!/^[0-9a-f]{32}$/i.test(nonce)) return false
  const expires = Number(expiresAt)
  if (!Number.isFinite(expires) || expires <= Date.now()) return false
  return timingSafeEqualHex(signature, hmacSha256Hex(`${nonce}.${expiresAt}`, secret))
}

function stateHash(state: string, secret: string): string {
  return sha256Hex(`${secret}:${state}`)
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

/** Geri dönüş adresinden veya açıkça verilen parametreden başvuru kimliğini çıkarır. */
function applicationIdFrom(returnTo: string, explicit: string | null): string | null {
  if (explicit && UUID_PATTERN.test(explicit)) return explicit
  try {
    const base = getAllowedOrigins()[0] ?? 'http://localhost:5173'
    const target = new URL(returnTo, base)
    const match = target.pathname.match(/\/admin\/applications\/([0-9a-f-]{36})\/?$/i)
    return match && UUID_PATTERN.test(match[1]) ? match[1] : null
  } catch {
    return null
  }
}

function redirect(url: string): Response {
  return new Response(null, { status: 302, headers: { Location: url } })
}

async function start(req: Request, url: URL): Promise<Response> {
  const clientId = env('DISCORD_CLIENT_ID')
  const redirectUri = env('DISCORD_REDIRECT_URI')
  const secret = env('SESSION_SECRET')
  if (!clientId || !redirectUri || !secret) {
    return error(
      'Discord yapılandırması eksik: DISCORD_CLIENT_ID, DISCORD_REDIRECT_URI ve SESSION_SECRET gerekli.',
      503,
      'configuration',
    )
  }
  const returnTo = url.searchParams.get('return_to') ?? '/'
  if (!isSafeReturnTo(returnTo)) return error('Geçersiz geri dönüş adresi.', 400, 'validation')

  const state = createState(secret)
  const applicationId = applicationIdFrom(returnTo, url.searchParams.get('application_id'))

  const authorize = new URL(AUTHORIZE_URL)
  authorize.searchParams.set('client_id', clientId)
  authorize.searchParams.set('redirect_uri', redirectUri)
  authorize.searchParams.set('response_type', 'code')
  authorize.searchParams.set('scope', 'identify')
  authorize.searchParams.set('state', state)
  authorize.searchParams.set('prompt', 'consent')

  const response = redirect(authorize.toString())
  response.headers.append('Set-Cookie', stateCookie(state))
  response.headers.append('Set-Cookie', `${RETURN_COOKIE}=${encodeURIComponent(returnTo)}; ${cookieOptions(STATE_MAX_AGE)}`)
  response.headers.append(
    'Set-Cookie',
    applicationId
      ? `${APP_COOKIE}=${applicationId}; ${cookieOptions(STATE_MAX_AGE)}`
      : clearedAppCookie(),
  )
  return response
}

async function callback(req: Request, url: URL): Promise<Response> {
  const clientId = env('DISCORD_CLIENT_ID')
  const clientSecret = env('DISCORD_CLIENT_SECRET')
  const redirectUri = env('DISCORD_REDIRECT_URI')
  const secret = env('SESSION_SECRET')
  if (!clientId || !clientSecret || !redirectUri || !secret) {
    return error('Discord yapılandırması eksik.', 503, 'configuration')
  }
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const cookieState = readCookie(req, OAUTH_STATE_COOKIE)
  if (
    !code ||
    !verifyState(state, secret) ||
    !cookieState ||
    !timingSafeEqualHex(state ?? '', cookieState)
  ) {
    return error('Discord doğrulama durumu geçersiz.', 400, 'invalid_state')
  }

  const db = await getAdminClient()
  if (!db.ok) return error(db.error, 503, 'configuration')

  const hash = stateHash(state as string, secret)
  // Aynı durum değeriyle ikinci bir bağlantı denemesi yapılamaz.
  const replay = await db.client
    .from('discord_links')
    .select('discord_user_id')
    .eq('oauth_state_hash', hash)
    .maybeSingle()
  if (replay.error) return error(defaultMessage(500), 500, 'database')
  if (replay.data) return error('Discord bağlantısı bulunamadı veya süresi doldu.', 400, 'invalid_state')

  try {
    const tokenResponse = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }).toString(),
    })
    if (!tokenResponse.ok) return error('Discord yetkilendirmesi başarısız.', 401, 'discord_auth')
    const tokenData = (await tokenResponse.json()) as { access_token?: string }
    if (!tokenData.access_token) return error('Discord yetkilendirmesi başarısız.', 401, 'discord_auth')

    const userResponse = await fetch(USER_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    if (!userResponse.ok) return error('Discord kullanıcı bilgileri alınamadı.', 401, 'discord_auth')
    const user = (await userResponse.json()) as {
      id?: string
      username?: string
      global_name?: string | null
    }
    if (!user.id) return error('Discord kullanıcı bilgileri alınamadı.', 401, 'discord_auth')

    const discordUserId = String(user.id)
    const discordUsername = String(user.username ?? user.global_name ?? user.id).slice(0, 64)
    const storedAppId = readCookie(req, APP_COOKIE) ?? ''
    const applicationId = UUID_PATTERN.test(storedAppId) ? storedAppId : null

    // discord_links birincil anahtarı discord_user_id'dir; state_hash/discord_id sütunları yoktur.
    const linked = await db.client.from('discord_links').upsert(
      {
        discord_user_id: discordUserId,
        discord_username: discordUsername,
        application_id: applicationId,
        linked_at: new Date().toISOString(),
        oauth_state_hash: hash,
      },
      { onConflict: 'discord_user_id' },
    )
    if (linked.error) return error(defaultMessage(500), 500, 'database')

    if (applicationId) {
      const associated = await db.client
        .from('applications')
        .update({ discord_user_id: discordUserId, discord_connected: true })
        .eq('id', applicationId)
      if (associated.error) return error(defaultMessage(500), 500, 'database')
    }

    const storedReturn = readCookie(req, RETURN_COOKIE) ?? '/'
    let returnTo = '/'
    try {
      const decoded = decodeURIComponent(storedReturn)
      if (isSafeReturnTo(decoded)) returnTo = decoded
    } catch {
      returnTo = '/'
    }
    const destination = new URL(returnTo, getAllowedOrigins()[0] ?? 'http://localhost:5173')
    destination.searchParams.set('discord', 'linked')
    destination.searchParams.set('username', discordUsername)
    const response = redirect(destination.toString())
    response.headers.append('Set-Cookie', clearedStateCookie())
    response.headers.append('Set-Cookie', clearedReturnCookie())
    response.headers.append('Set-Cookie', clearedAppCookie())
    return response
  } catch {
    return error('Discord bağlantısı tamamlanamadı.', 502, 'discord_error')
  }
}

async function run(req: Request): Promise<Response> {
  const url = new URL(req.url)
  let action = url.searchParams.get('action')
  if (!action && req.method === 'POST') {
    const parsed = await readJson(req)
    if (parsed.ok && typeof (parsed.data as any)?.action === 'string') {
      action = (parsed.data as any).action
    }
  }
  if (!action) action = /\/callback\/?$/.test(url.pathname) ? 'callback' : 'start'
  if (action === 'start') return start(req, url)
  if (action === 'callback') return callback(req, url)
  return error('Bilinmeyen işlem.', 400, 'unknown_action')
}

;(globalThis as any).Deno.serve(async (req: Request): Promise<Response> => {
  const options = preflight(req)
  if (options) return options
  try {
    return withCors(req, await run(req))
  } catch {
    return withCors(req, error(defaultMessage(500), 500, 'internal'))
  }
})
