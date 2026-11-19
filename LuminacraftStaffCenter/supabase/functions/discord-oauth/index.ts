// Discord OAuth2 bağlama akışı. Erişim belirteci yalnızca sunucuda kullanılır, asla günlüğe yazılmaz.
import { OAUTH_STATE_COOKIE, readCookie } from '../_shared/auth.ts'
import { preflight, withCors } from '../_shared/cors.ts'
import { getAdminClient } from '../_shared/db.ts'
import { bytesToHex, env, isSafeReturnTo, sha256Hex, timingSafeEqualHex } from '../_shared/pure.ts'
import { defaultMessage, error } from '../_shared/responses.ts'
import { readJson } from '../_shared/validation.ts'

const AUTHORIZE_URL = 'https://discord.com/oauth2/authorize'
const TOKEN_URL = 'https://discord.com/api/oauth2/token'
const USER_URL = 'https://discord.com/api/users/@me'
const STATE_MAX_AGE = 600

function stateCookie(value: string): string {
  return `${OAUTH_STATE_COOKIE}=${value}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${STATE_MAX_AGE}`
}

function clearedStateCookie(): string {
  return `${OAUTH_STATE_COOKIE}=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0`
}

function stateHash(state: string): string {
  return sha256Hex(`${env('SESSION_SECRET') ?? ''}:${state}`)
}

function redirect(url: string): Response {
  return new Response(null, { status: 302, headers: { Location: url } })
}

async function start(req: Request, url: URL): Promise<Response> {
  const clientId = env('DISCORD_CLIENT_ID')
  const redirectUri = env('DISCORD_REDIRECT_URI')
  if (!clientId || !redirectUri) {
    return error('Discord yapılandırması eksik: DISCORD_CLIENT_ID ve DISCORD_REDIRECT_URI gerekli.', 503, 'configuration')
  }
  const returnTo = url.searchParams.get('return_to') ?? '/'
  if (!isSafeReturnTo(returnTo)) return error('Geçersiz geri dönüş adresi.', 400, 'validation')

  const stateBytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(stateBytes)
  const state = bytesToHex(stateBytes)
  const db = await getAdminClient()
  if (!db.ok) return error(db.error, 503, 'configuration')
  const inserted = await db.client.from('discord_links').insert({
    state_hash: stateHash(state),
    discord_id: null,
    discord_username: null,
    linked_at: new Date().toISOString(),
  })
  if (inserted.error) return error(defaultMessage(500), 500, 'database')

  const authorize = new URL(AUTHORIZE_URL)
  authorize.searchParams.set('client_id', clientId)
  authorize.searchParams.set('redirect_uri', redirectUri)
  authorize.searchParams.set('response_type', 'code')
  authorize.searchParams.set('scope', 'identify')
  authorize.searchParams.set('state', state)
  authorize.searchParams.set('prompt', 'consent')

  const response = redirect(authorize.toString())
  response.headers.append('Set-Cookie', stateCookie(state))
  response.headers.append('Set-Cookie', `lsc_oauth_return=${encodeURIComponent(returnTo)}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${STATE_MAX_AGE}`)
  return response
}

async function callback(req: Request, url: URL): Promise<Response> {
  const clientId = env('DISCORD_CLIENT_ID')
  const clientSecret = env('DISCORD_CLIENT_SECRET')
  const redirectUri = env('DISCORD_REDIRECT_URI')
  if (!clientId || !clientSecret || !redirectUri) {
    return error('Discord yapılandırması eksik.', 503, 'configuration')
  }
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const cookieState = readCookie(req, OAUTH_STATE_COOKIE)
  if (!code || !state || !cookieState || !timingSafeEqualHex(state, cookieState)) {
    return error('Discord doğrulama durumu geçersiz.', 400, 'invalid_state')
  }

  const db = await getAdminClient()
  if (!db.ok) return error(db.error, 503, 'configuration')
  const hash = stateHash(state)
  const link = await db.client
    .from('discord_links')
    .select('id')
    .eq('state_hash', hash)
    .maybeSingle()
  if (link.error) return error(defaultMessage(500), 500, 'database')
  if (!link.data) return error('Discord bağlantısı bulunamadı veya süresi doldu.', 400, 'invalid_state')

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
    const user = (await userResponse.json()) as { id?: string; username?: string }
    if (!user.id) return error('Discord kullanıcı bilgileri alınamadı.', 401, 'discord_auth')

    const updated = await db.client
      .from('discord_links')
      .update({
        discord_id: String(user.id),
        discord_username: String(user.username ?? '').slice(0, 64),
        linked_at: new Date().toISOString(),
      })
      .eq('id', link.data.id)
    if (updated.error) return error(defaultMessage(500), 500, 'database')

    const storedReturn = readCookie(req, 'lsc_oauth_return') ?? '/'
    let returnTo = '/'
    try {
      const decoded = decodeURIComponent(storedReturn)
      if (isSafeReturnTo(decoded)) returnTo = decoded
    } catch {
      returnTo = '/'
    }
    const destination = new URL(returnTo, env('ALLOWED_ORIGINS')?.split(',')[0]?.trim() || 'http://localhost:5173')
    destination.searchParams.set('discord', 'linked')
    destination.searchParams.set('username', String(user.username ?? ''))
    const response = redirect(destination.toString())
    response.headers.append('Set-Cookie', clearedStateCookie())
    response.headers.append('Set-Cookie', 'lsc_oauth_return=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0')
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
