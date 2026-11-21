// Başvuru sorgulama: yalnızca SECURITY DEFINER RPC üzerinden güvenli alanlar döner.
import { preflight, withCors } from '../_shared/cors.ts'
import { getAdminClient } from '../_shared/db.ts'
import { defaultMessage, error, json } from '../_shared/responses.ts'
import { readJson, validate } from '../_shared/validation.ts'

type StatusData = { tracking_no: string; query_token: string }

// lookup_application(text, text) yalnızca bu alanları döndürür (0002).
// Notlar, puanlar, ham sorgu anahtarı ve iletişim bilgileri asla yer almaz.
const SAFE_FIELDS = [
  'tracking_no',
  'position_slug',
  'status',
  'submitted_at',
  'decided_at',
  'status_history',
] as const

async function run(req: Request): Promise<Response> {
  if (req.method !== 'POST') return error(defaultMessage(405), 405, 'method_not_allowed')
  const parsed = await readJson(req)
  if (!parsed.ok) return error(parsed.error, 400, 'invalid_body')
  const checked = await validate<StatusData>('publicStatus', parsed.data)
  if (!checked.ok) return error(checked.error, 400, 'validation')

  const db = await getAdminClient()
  if (!db.ok) return error(db.error, 503, 'configuration')

  let result: any = null
  try {
    // Fonksiyon ham sorgu anahtarını kendisi sha256 ile doğrular (0002).
    result = await db.client.rpc('lookup_application', {
      p_tracking_no: checked.data.tracking_no,
      p_query_token: checked.data.query_token,
    })
  } catch {
    return error(defaultMessage(500), 500, 'database')
  }
  if (result?.error) return error(defaultMessage(500), 500, 'database')

  const payload = result?.data
  const row = (Array.isArray(payload) ? payload[0] : payload) as Record<string, unknown> | null
  if (!row) {
    return error('Başvuru bulunamadı veya sorgu anahtarı hatalı.', 404, 'not_found')
  }
  const safe: Record<string, unknown> = {}
  for (const field of SAFE_FIELDS) {
    if (row[field] !== undefined && row[field] !== null) safe[field] = row[field]
  }
  // Genel istemci sözleşmesindeki `decision_date` karşılığı şemadaki `decided_at`'tır.
  if (safe.decided_at !== undefined) safe.decision_date = safe.decided_at
  return json({ ok: true, application: safe })
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
