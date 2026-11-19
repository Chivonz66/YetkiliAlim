// Yönetici girişi, oturum doğrulama ve ilk yönetici durumu.
import {
  clearedSessionCookies,
  createSessionToken,
  csrfCookie,
  hashPassword,
  newCsrfToken,
  readCookie,
  requireAdmin,
  sessionCookie,
  CSRF_COOKIE,
  verifyPassword,
} from '../_shared/auth.ts'
import { preflight, withCors } from '../_shared/cors.ts'
import { getAdminClient, writeAudit } from '../_shared/db.ts'
import { defaultMessage, error, json } from '../_shared/responses.ts'
import { readJson, validate } from '../_shared/validation.ts'

type LoginData = { username: string; password: string }
type SetupData = { username: string; password: string }

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
      const { data, error: dbError } = await client.from('admins').select('id').limit(1)
      if (dbError) return error(defaultMessage(500), 500, 'database')
      const hasAdmin = Array.isArray(data) && data.length > 0
      return json({ ok: true, has_admin: hasAdmin, setup_required: !hasAdmin })
    }

    if (action === 'login') {
      const checked = await validate<LoginData>('login', body)
      if (!checked.ok) return error(checked.error, 400, 'validation')
      const { data: admin, error: dbError } = await client
        .from('admins')
        .select('id, username, password_hash, is_active')
        .eq('username', checked.data.username)
        .maybeSingle()
      if (dbError) return error(defaultMessage(500), 500, 'database')
      if (!admin || admin.is_active === false) {
        return error('Kullanıcı adı veya şifre hatalı.', 401, 'invalid_credentials')
      }
      const valid = await verifyPassword(checked.data.password, admin.password_hash as string)
      if (!valid) return error('Kullanıcı adı veya şifre hatalı.', 401, 'invalid_credentials')

      await client.from('admins').update({ last_login_at: new Date().toISOString() }).eq('id', admin.id)
      const token = createSessionToken(admin.id as string)
      const csrf = newCsrfToken()
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
      // Yalnızca hiç yönetici yokken ilk yöneticiyi oluşturur.
      const { data: existing, error: readError } = await client.from('admins').select('id').limit(1)
      if (readError) return error(defaultMessage(500), 500, 'database')
      if (existing && existing.length > 0) {
        return error('İlk yönetici zaten oluşturulmuş.', 403, 'forbidden')
      }
      const checked = await validate<SetupData>('login', body)
      if (!checked.ok) return error(checked.error, 400, 'validation')
      const passwordHash = await hashPassword(checked.data.password)
      const { data: created, error: insertError } = await client
        .from('admins')
        .insert({ username: checked.data.username, password_hash: passwordHash })
        .select('id, username')
        .single()
      if (insertError || !created) return error('Yönetici oluşturulamadı.', 500, 'database')
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
