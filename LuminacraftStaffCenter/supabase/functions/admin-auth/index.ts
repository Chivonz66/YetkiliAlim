// Yönetici girişi, oturum doğrulama ve ilk yönetici durumu.
import {
  clearedSessionCookies,
  clientIp,
  createSessionToken,
  csrfCookie,
  hashPassword,
  INVALID_CREDENTIALS_MESSAGE,
  isLoginLocked,
  loginRateLimitKey,
  loginWindowStart,
  LOGIN_LOCKED_MESSAGE,
  newCsrfToken,
  readCookie,
  requireAdmin,
  sessionCookie,
  sessionTokenHash,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  verifyPassword,
  CSRF_COOKIE,
} from '../_shared/auth.ts'
import { preflight, withCors } from '../_shared/cors.ts'
import { getAdminClient, writeAudit } from '../_shared/db.ts'
import { env, sha256Hex, timingSafeEqualHex } from '../_shared/pure.ts'
import { defaultMessage, error, json } from '../_shared/responses.ts'
import { readJson, validate } from '../_shared/validation.ts'

type LoginData = { username: string; password: string }
type SetupData = { username: string; password: string }

/** setup yalnızca sunucuda tanımlı gizli anahtarla çağrılabilir. */
function hasSetupSecret(req: Request): boolean {
  const expected = env('ADMIN_SETUP_SECRET')
  const provided = req.headers.get('x-admin-setup-secret')
  if (!expected || !provided) return false
  return timingSafeEqualHex(sha256Hex(provided), sha256Hex(expected))
}

/**
 * rate_limits penceresinde başarısız giriş sayısını artırır.
 * Ham IP/kullanıcı adı yalnızca özet anahtarda tutulur; hata durumunda null döner.
 */
async function recordFailedLogin(
  client: any,
  key: string,
  windowStart: string,
): Promise<number | null> {
  try {
    const existing = await client
      .from('rate_limits')
      .select('hit_count')
      .eq('key', key)
      .eq('window_start', windowStart)
      .maybeSingle()
    if (existing.error) return null
    const count = Number(existing.data?.hit_count ?? 0)
    if (existing.data && Number.isFinite(count)) {
      const updated = await client
        .from('rate_limits')
        .update({ hit_count: count + 1 })
        .eq('key', key)
        .eq('window_start', windowStart)
      return updated.error ? null : count + 1
    }
    const upserted = await client
      .from('rate_limits')
      .upsert({ key, window_start: windowStart, hit_count: 1 }, { onConflict: 'key,window_start' })
    return upserted.error ? null : 1
  } catch {
    return null
  }
}

async function run(req: Request): Promise<Response> {
  const method = req.method
  if (method !== 'GET' && method !== 'POST') {
    return error(defaultMessage(405), 405, 'method_not_allowed')
  }

  let body: Record<string, unknown> = {}
  let action = method === 'GET' ? 'verify' : 'login'
  if (method === 'POST') {
    const parsed = await readJson(req)
    if (!parsed.ok) return error(parsed.error, 400, 'invalid_body')
    body = parsed.data as Record<string, unknown>
    if (typeof body.action === 'string' && body.action) action = body.action
  }

  const db = await getAdminClient()
  if (!db.ok) return error(db.error, 503, 'configuration')
  const client = db.client

  try {
    if (action === 'setup-status') {
      // Bilgi amaçlıdır: ilk yönetici yalnızca sunucu tarafındaki CLI ile oluşturulur.
      const { data, error: dbError } = await client.from('admins').select('id').limit(1)
      if (dbError) return error(defaultMessage(500), 500, 'database')
      const hasAdmin = Array.isArray(data) && data.length > 0
      return json({ ok: true, has_admin: hasAdmin, setup_required: !hasAdmin })
    }

    if (action === 'login') {
      const checked = await validate<LoginData>('login', body)
      if (!checked.ok) return error(checked.error, 400, 'validation')

      // IP + kullanıcı adı kilidi: başarısız denemeler sayılır, başarıda sıfırlanır.
      const limitKey = loginRateLimitKey(clientIp(req), checked.data.username)
      const windowStart = loginWindowStart()
      const { data: attempts, error: limiterError } = await client
        .from('rate_limits')
        .select('hit_count, window_start')
        .eq('key', limitKey)
        .eq('window_start', windowStart)
        .maybeSingle()
      if (limiterError) return error(LOGIN_LOCKED_MESSAGE, 429, 'rate_limited')
      if (isLoginLocked(attempts?.hit_count)) {
        return error(LOGIN_LOCKED_MESSAGE, 429, 'rate_limited')
      }

      const fail = async (): Promise<Response> => {
        const count = await recordFailedLogin(client, limitKey, windowStart)
        if (count === null) return error(LOGIN_LOCKED_MESSAGE, 429, 'rate_limited')
        if (isLoginLocked(count)) return error(LOGIN_LOCKED_MESSAGE, 429, 'rate_limited')
        // Kullanıcı yok, pasif veya parola yanlış: aynı mesaj; ayrım yapılmaz.
        return error(INVALID_CREDENTIALS_MESSAGE, 401, 'invalid_credentials')
      }

      const { data: admin, error: dbError } = await client
        .from('admins')
        .select('id, username, password_hash, is_active')
        .eq('username', checked.data.username)
        .maybeSingle()
      if (dbError) return error(defaultMessage(500), 500, 'database')
      if (!admin || admin.is_active === false) return fail()

      const valid = await verifyPassword(checked.data.password, admin.password_hash as string)
      if (!valid) return fail()

      await client.from('rate_limits').delete().eq('key', limitKey).eq('window_start', windowStart)
      await client.from('admins').update({ last_login_at: new Date().toISOString() }).eq('id', admin.id)

      const token = createSessionToken(admin.id as string)
      const csrf = newCsrfToken()
      const expiresAt = new Date(
        Math.floor(Date.now() / 1000) * 1000 + SESSION_MAX_AGE * 1000,
      ).toISOString()
      // Oturum satırı olmadan belirteç geçerli sayılmaz; iptal süresi db'de tutulur.
      const { error: sessionError } = await client.from('admin_sessions').insert({
        token_hash: sessionTokenHash(token),
        admin_id: admin.id as string,
        csrf_token: csrf,
        expires_at: expiresAt,
      })
      if (sessionError) return error(defaultMessage(500), 500, 'database')

      const response = json({
        ok: true,
        csrf_token: csrf,
        admin: { username: admin.username as string },
      })
      response.headers.append('Set-Cookie', sessionCookie(token))
      response.headers.append('Set-Cookie', csrfCookie(csrf))
      return response
    }

    if (action === 'setup') {
      if (method !== 'POST') return error(defaultMessage(405), 405, 'method_not_allowed')
      if (!hasSetupSecret(req)) return error('Kurulum izni yok.', 403, 'forbidden')
      const checked = await validate<SetupData>('setup', body)
      if (!checked.ok) return error(checked.error, 400, 'validation')
      const passwordHash = await hashPassword(checked.data.password)
      // RPC: danışma kilidi + "yönetici var mı?" + INSERT tek işlemde yapılır.
      const { data, error: rpcError } = await client.rpc('create_first_admin', {
        p_username: checked.data.username,
        p_password_hash: passwordHash,
      })
      if (rpcError) {
        if (/admin_exists/i.test(String(rpcError.message))) {
          return error('İlk yönetici zaten oluşturulmuş.', 403, 'forbidden')
        }
        return error(defaultMessage(500), 500, 'database')
      }
      const created = Array.isArray(data) ? data[0] : data
      if (!created?.id) return error('Yönetici oluşturulamadı.', 500, 'database')
      await writeAudit(client, null, 'admin_setup', 'admins', created.id, {})
      return json({ ok: true, admin: { username: created.username as string } }, 201)
    }

    if (action === 'verify') {
      const auth = await requireAdmin(req)
      if (!auth.ok) return auth.response
      const { data: admin, error: dbError } = await client
        .from('admins')
        .select('username')
        .eq('id', auth.adminId)
        .maybeSingle()
      if (dbError) return error(defaultMessage(500), 500, 'database')
      if (!admin) return error(defaultMessage(401), 401, 'unauthorized')
      return json({
        ok: true,
        admin: { username: admin.username as string },
        csrf_token: readCookie(req, CSRF_COOKIE),
      })
    }

    if (action === 'logout') {
      const auth = await requireAdmin(req, { csrf: true })
      if (!auth.ok) return auth.response
      const token = readCookie(req, SESSION_COOKIE)
      if (token) {
        // Oturum satırını iptal et; çerez silinse bile belirtec yeniden kullanılamaz.
        await client
          .from('admin_sessions')
          .update({ revoked_at: new Date().toISOString() })
          .eq('token_hash', sessionTokenHash(token))
          .is('revoked_at', null)
      }
      await writeAudit(client, auth.adminId, 'admin_logout', 'admins', auth.adminId, {})
      const response = json({ ok: true })
      for (const cookie of clearedSessionCookies()) response.headers.append('Set-Cookie', cookie)
      return response
    }

    return error('Bilinmeyen işlem.', 400, 'unknown_action')
  } catch {
    return error(defaultMessage(500), 500, 'internal')
  }
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
