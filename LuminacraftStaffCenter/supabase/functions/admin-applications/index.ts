// Başvuru listesi/detayı ve karar kaydı. Karar denetim kaydına yazılır.
import { requireAdmin } from '../_shared/auth.ts'
import { preflight, withCors } from '../_shared/cors.ts'
import { getAdminClient, writeAudit } from '../_shared/db.ts'
import { defaultMessage, error, json } from '../_shared/responses.ts'
import { readJson, validate } from '../_shared/validation.ts'

type DecisionData = { status: 'pending' | 'reviewing' | 'accepted' | 'rejected'; note?: string }

function safeSearch(value: string): string {
  return value.replace(/[,()%\\]/g, ' ').trim().slice(0, 100)
}

async function single(client: any, id: string): Promise<Response> {
  const application = await client.from('applications').select('*').eq('id', id).maybeSingle()
  if (application.error) return error(defaultMessage(500), 500, 'database')
  if (!application.data) return error(defaultMessage(404), 404, 'not_found')
  const [answers, scores, notes, history] = await Promise.all([
    client.from('application_answers').select('*').eq('application_id', id).order('created_at', { ascending: true }),
    client.from('application_scores').select('*').eq('application_id', id),
    client.from('application_notes').select('*').eq('application_id', id).order('created_at', { ascending: false }),
    client.from('application_history').select('*').eq('application_id', id).order('created_at', { ascending: true }),
  ])
  if (answers.error || scores.error || notes.error || history.error) {
    return error(defaultMessage(500), 500, 'database')
  }
  return json({
    ok: true,
    application: application.data,
    answers: answers.data ?? [],
    scores: scores.data ?? [],
    notes: notes.data ?? [],
    history: history.data ?? [],
  })
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
      const id = url.searchParams.get('id')
      if (id) return await single(client, id)

      let query = client.from('applications').select('*', { count: 'exact' })
      const status = url.searchParams.get('status')
      if (status && status !== 'all') query = query.eq('status', status)
      const position = url.searchParams.get('position') ?? url.searchParams.get('position_slug')
      if (position && position !== 'all') query = query.eq('position_slug', position)
      const search = safeSearch(url.searchParams.get('search') ?? '')
      if (search) {
        query = query.or(
          `tracking_no.ilike.%${search}%,applicant_minecraft_username.ilike.%${search}%,applicant_discord_username.ilike.%${search}%`,
        )
      }
      const limit = Math.min(200, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50))
      const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0)
      const result = await query
        .order('submitted_at', { ascending: false })
        .range(offset, offset + limit - 1)
      if (result.error) return error(defaultMessage(500), 500, 'database')
      return json({
        ok: true,
        applications: result.data ?? [],
        total: result.count ?? (result.data?.length ?? 0),
        limit,
        offset,
      })
    }

    if (method === 'PATCH') {
      const parsed = await readJson(req)
      if (!parsed.ok) return error(parsed.error, 400, 'invalid_body')
      const body = parsed.data as Record<string, unknown>
      const id = body.id ?? url.searchParams.get('id')
      if (typeof id !== 'string' || !id) return error('Başvuru kimliği belirtilmeli.', 400, 'validation')
      const checked = await validate<DecisionData>('decision', body)
      if (!checked.ok) return error(checked.error, 400, 'validation')

      const current = await client.from('applications').select('*').eq('id', id).maybeSingle()
      if (current.error) return error(defaultMessage(500), 500, 'database')
      if (!current.data) return error(defaultMessage(404), 404, 'not_found')

      const statusChanged = current.data.status !== checked.data.status
      const note = typeof checked.data.note === 'string' ? checked.data.note.trim() : ''
      let application = current.data
      let auditWarning: string | null = null

      // Karar notu yöneticiye özel kayıttır; durum tetikleyicisiyle aynı
      // eylemi çift denetim kaydı olarak yazmaz.
      if (note) {
        const savedNote = await client.from('application_notes').insert({
          application_id: id,
          admin_id: auth.adminId,
          note,
        })
        if (savedNote.error) return error(defaultMessage(500), 500, 'database')
        const audit = await writeAudit(client, auth.adminId, 'decision_note_create', 'application_notes', id, {
          status: checked.data.status,
        })
        if (!audit.ok) auditWarning = audit.error
      }

      const decision = {
        status: checked.data.status,
        decided_at: new Date().toISOString(),
        decided_by: auth.adminId,
      }

      // Durum gerçekten değiştiyse aktör bağlamı işlem içinde ayarlanır;
      // geçmiş ve denetim kaydını 0003 tetikleyicisi bir kez yazar.
      if (statusChanged) {
        const applied = await client.rpc('apply_application_decision', {
          p_application_id: id,
          ...decision,
        })
        if (applied.error) return error(defaultMessage(500), 500, 'database')
        if (!applied.data) return error(defaultMessage(404), 404, 'not_found')
        application = applied.data
      }

      return json({
        ok: true,
        application,
        status_changed: statusChanged,
        ...(auditWarning ? { audit_warning: auditWarning } : {}),
      })
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
