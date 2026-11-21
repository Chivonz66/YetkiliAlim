// Discord OAuth2 bağlama akışı. Erişim belirteci yalnızca sunucuda kullanılır, asla günlüğe yazılmaz.
import { OAUTH_STATE_COOKIE, readCookie, requireAdmin } from '../_shared/auth.ts'
import { preflight, withCors } from '../_shared/cors.ts'
import { getAdminClient } from '../_shared/db.ts'
import {
  bytesToHex,
  env,
  getAllowedOrigins,
  hmacSha256Hex,
  isSafeReturnTo,
  sha256Hex,
  signSessionToken,
  timingSafeEqualHex,
  verifySessionToken,
} from '../_shared/pure.ts'
import { defaultMessage, error, json } from '../_shared/responses.ts'
import { readJson } from '../_shared/validation.ts'

const AUTHORIZE_URL = 'https://discord.com/oauth2/authorize'
const TOKEN_URL = 'https://discord.com/api/oauth2/token'
const USER_URL = 'https://discord.com/api/users/@me'
const STATE_MAX_AGE = 600
const LINK_TOKEN_MAX_AGE = 3600
const RETURN_COOKIE = 'lsc_oauth_return'
const APP_COOKIE = 'lsc_oauth_app'
const LINK_COOKIE = 'lsc_discord_link_token'
const PENDING_NONCE_PREFIX = 'discord-link:pending:'
const BOUND_NONCE_PREFIX = 'discord-link:bound:'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DISCORD_ID_PATTERN = /^\d{5,25}$/

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

function clearedLinkCookie(): string {
  return `${LINK_COOKIE}=; ${cookieOptions(0)}`
}

/**
 * Başvuru formuna verilen geçici bağlantı belirteci SESSION_SECRET ile imzalanır.
 * `pending`: OAuth başlangıcı; `bound`: Discord kimliği bağlandıktan sonra dönen belirteç.
 * İki aşama birbirinin yerine kullanılamaz; yönetici oturum belirteci de kabul edilmez.
 */
function createLinkToken(
  subject: string,
  stage: 'pending' | 'bound',
  secret: string,
): string {
  const prefix = stage === 'bound' ? BOUND_NONCE_PREFIX : PENDING_NONCE_PREFIX
  return signSessionToken(
    {
      sub: subject,
      exp: Math.floor(Date.now() / 1000) + LINK_TOKEN_MAX_AGE,
      nonce: `${prefix}${bytesToHex(randomBytes(16))}`,
    },
    secret,
  )
}

function verifyLinkToken(
  token: string | null | undefined,
  stage: 'pending' | 'bound',
  secret: string,
): string | null {
  if (!token) return null
  const payload = verifySessionToken(token, secret)
  if (!payload) return null
  const prefix = stage === 'bound' ? BOUND_NONCE_PREFIX : PENDING_NONCE_PREFIX
  if (!payload.nonce.startsWith(prefix)) return null
  if (stage === 'bound' && !DISCORD_ID_PATTERN.test(payload.sub)) return null
  return payload.sub
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

/**
 * Yönetim sayfası yolundan başvuru kimliği çıkarır. İstemciden gelen
 * `application_id` parametresi asla kabul edilmez; yalnızca yönetici oturumu
 * doğrulanmışsa bu değer bağlantıya eşlik edebilir.
 */
function adminApplicationIdFromReturnTo(returnTo: string): string | null {
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

  // Başvuru formu imzalı belirteci gönderir; imzasız/rastgele değer reddedilir.
  const pendingToken = verifyLinkToken(url.searchParams.get('discord_link_token'), 'pending', secret)
  if (!pendingToken) {
    return error('Discord bağlantı belirteci geçersiz.', 400, 'invalid_link_token')
  }

  const state = createState(secret)
  // Yönetim akışında başvuru kimliği yalnızca oturum doğrulanmışsa bağlanır.
  // Genel başvuru akışında application_id asla istemciden alınmaz.
  let applicationId: string | null = null
  const adminPathId = adminApplicationIdFromReturnTo(returnTo)
  if (adminPathId) {
    const admin = await requireAdmin(req, { csrf: false })
    if (admin.ok) applicationId = adminPathId
  }

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
  response.headers.append(
    'Set-Cookie',
    `${LINK_COOKIE}=${encodeURIComponent(String(url.searchParams.get('discord_link_token') ?? ''))}; ${cookieOptions(LINK_TOKEN_MAX_AGE)}`,
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
  if (!verifyLinkToken(readCookie(req, LINK_COOKIE), 'pending', secret)) {
    return error('Discord bağlantı belirteci geçersiz.', 400, 'invalid_link_token')
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

    if (!DISCORD_ID_PATTERN.test(String(user.id))) {
      return error('Discord kullanıcı bilgileri alınamadı.', 401, 'discord_auth')
    }
    const discordUserId = String(user.id)
    const discordUsername = String(user.username ?? user.global_name ?? user.id).slice(0, 64)
    // Yalnızca yönetici oturumu doğrulanmış yoldan gelen kimlik kullanılabilir.
    const storedAppId = readCookie(req, APP_COOKIE) ?? ''
    const applicationId = UUID_PATTERN.test(storedAppId) ? storedAppId : null
    // Discord kimliği yeni, imzalı ve tek kullanımlık bağlantı belirtecine bağlanır.
    const boundToken = createLinkToken(discordUserId, 'bound', secret)

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
    destination.searchParams.set('discord_link_token', boundToken)
    const response = redirect(destination.toString())
    response.headers.append('Set-Cookie', clearedStateCookie())
    response.headers.append('Set-Cookie', clearedReturnCookie())
    response.headers.append('Set-Cookie', clearedAppCookie())
    response.headers.append('Set-Cookie', clearedLinkCookie())
    return response
  } catch {
    return error('Discord bağlantısı tamamlanamadı.', 502, 'discord_error')
  }
}

/** Genel formun OAuth'a başlamadan önce imzalı, bekleyen bağlantı belirteci aldığı uç. */
function linkTokenAction(): Promise<Response> {
  const secret = env('SESSION_SECRET')
  if (!secret) {
    return Promise.resolve(
      error('Discord yapılandırması eksik: SESSION_SECRET gerekli.', 503, 'configuration'),
    )
  }
  const token = createLinkToken(bytesToHex(randomBytes(16)), 'pending', secret)
  return Promise.resolve(json({ ok: true, discord_link_token: token }))
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
  if (action === 'link-token') return linkTokenAction()
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
