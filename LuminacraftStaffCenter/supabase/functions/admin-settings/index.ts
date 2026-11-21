// Uygulama ayarları: başvuru açıklığı, kapalı mesajı, site başlığı ve oran sınırı.
import { requireAdmin } from '../_shared/auth.ts'
import { preflight, withCors } from '../_shared/cors.ts'
import { getAdminClient, writeAudit } from '../_shared/db.ts'
import { defaultMessage, error, json } from '../_shared/responses.ts'
import { readJson, validate } from '../_shared/validation.ts'

function parseValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^-?\d+$/.test(value)) return Number(value)
  return value
}

function toMap(rows: any[]): Record<string, unknown> {
  const settings: Record<string, unknown> = {}
  for (const row of rows ?? []) settings[row.key] = parseValue(row.value)
  return settings
}

async function run(req: Request): Promise<Response> {
  const method = req.method
  const auth = await requireAdmin(req, { csrf: method !== 'GET' })
  if (!auth.ok) return auth.response
  const db = await getAdminClient()
  if (!db.ok) return error(db.error, 503, 'configuration')
  const client = db.client

  try {
    if (method === 'GET') {
      const result = await client.from('app_settings').select('*').order('key', { ascending: true })
      if (result.error) return error(defaultMessage(500), 500, 'database')
      return json({ ok: true, settings: toMap(result.data ?? []), rows: result.data ?? [] })
    }
    if (method !== 'PATCH' && method !== 'POST') {
      return error(defaultMessage(405), 405, 'method_not_allowed')
    }

    const parsed = await readJson(req)
    if (!parsed.ok) return error(parsed.error, 400, 'invalid_body')
    const checked = await validate<{ settings?: Record<string, unknown>; key?: string; value?: unknown }>(
      'settingsPatch',
      parsed.data,
    )
    if (!checked.ok) return error(checked.error, 400, 'validation')

    const entries = checked.data.settings
      ? Object.entries(checked.data.settings)
      : [[checked.data.key as string, checked.data.value]]
    if (entries.length === 0) return error('Güncellenecek ayar belirtilmeli.', 400, 'validation')

    for (const [key, value] of entries) {
      // app_settings.value bir jsonb sütunudur; değer dönüştürülmeden saklanır.
      const row: Record<string, unknown> = {
        key,
        value: value ?? null,
        updated_at: new Date().toISOString(),
      }
      const upsert = await client.from('app_settings').upsert(row, { onConflict: 'key' })
      if (upsert.error) return error(defaultMessage(500), 500, 'database')
    }
    await writeAudit(client, auth.adminId, 'settings_update', 'app_settings', null, {
      keys: entries.map(([key]) => key),
    })
    const fresh = await client.from('app_settings').select('*').order('key', { ascending: true })
    if (fresh.error) return error(defaultMessage(500), 500, 'database')
    return json({ ok: true, settings: toMap(fresh.data ?? []), rows: fresh.data ?? [] })
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
