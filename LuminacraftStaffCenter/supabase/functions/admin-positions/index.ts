// Pozisyon yönetimi: aktiflik, başvuru açıklığı ve açıklamalar.
import { requireAdmin } from '../_shared/auth.ts'
import { preflight, withCors } from '../_shared/cors.ts'
import { getAdminClient, writeAudit } from '../_shared/db.ts'
import { defaultMessage, error, json } from '../_shared/responses.ts'
import { readJson, validate } from '../_shared/validation.ts'

type PositionBody = Record<string, any>

/**
 * positions şemasında `is_open` sütunu yoktur; başvuru açıklığı app_settings
 * üzerinden yönetilir. Yazmalarda yalnızca gerçek sütunlar bırakılır.
 */
function toDbFields(fields: Record<string, any>): Record<string, any> {
  const { is_open: _ignored, ...rest } = fields
  return rest
}

async function run(req: Request): Promise<Response> {
  const method = req.method
  const url = new URL(req.url)
  const auth = await requireAdmin(req, { csrf: method !== 'GET' })
  if (!auth.ok) return auth.response
  const db = await getAdminClient()
  if (!db.ok) return error(db.error, 503, 'configuration')
  const client = db.client

  try {
    if (method === 'GET') {
      const result = await client.from('positions').select('*').order('sort_order', { ascending: true })
      if (result.error) return error(defaultMessage(500), 500, 'database')
      return json({ ok: true, positions: result.data ?? [] })
    }

    const parsed = await readJson(req)
    if (!parsed.ok) return error(parsed.error, 400, 'invalid_body')
    const body = parsed.data as PositionBody

    if (method === 'POST') {
      const checked = await validate<PositionBody>('position', body)
      if (!checked.ok) return error(checked.error, 400, 'validation')
      const inserted = await client
        .from('positions')
        .insert(toDbFields(checked.data))
        .select('*')
        .single()
      if (inserted.error || !inserted.data) return error(defaultMessage(500), 500, 'database')
      await writeAudit(client, auth.adminId, 'position_create', 'positions', inserted.data.id, {})
      return json({ ok: true, position: inserted.data }, 201)
    }

    if (method === 'PATCH') {
      const id = body.id ?? url.searchParams.get('id')
      if (typeof id !== 'string' || !id) return error('Pozisyon kimliği belirtilmeli.', 400, 'validation')
      const checked = await validate<PositionBody>('positionPatch', body)
      if (!checked.ok) return error(checked.error, 400, 'validation')
      const { id: _bodyId, ...fields } = checked.data
      const updated = await client
        .from('positions')
        .update(toDbFields(fields))
        .eq('id', id)
        .select('*')
        .maybeSingle()
      if (updated.error) return error(defaultMessage(500), 500, 'database')
      if (!updated.data) return error(defaultMessage(404), 404, 'not_found')
      await writeAudit(client, auth.adminId, 'position_update', 'positions', id, {
        fields: Object.keys(fields),
      })
      return json({ ok: true, position: updated.data })
    }

    return error(defaultMessage(405), 405, 'method_not_allowed')
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
