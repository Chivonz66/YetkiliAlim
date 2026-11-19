// Başvuru listesi/detayı ve karar kaydı. Karar, bildirim kuyruğuna eklenir.
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
          `tracking_no.ilike.%${search}%,applicant_name.ilike.%${search}%,applicant_email.ilike.%${search}%`,
        )
      }
      const limit = Math.min(200, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50))
      const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0)
      const result = await query
        .order('created_at', { ascending: false })
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

      const current = await client
        .from('applications')
        .select('id, status, tracking_no')
        .eq('id', id)
        .maybeSingle()
      if (current.error) return error(defaultMessage(500), 500, 'database')
      if (!current.data) return error(defaultMessage(404), 404, 'not_found')

      if (current.data.status !== checked.data.status) {
        const historyInsert = await client.from('application_history').insert({
          application_id: id,
          from_status: current.data.status,
          to_status: checked.data.status,
          changed_by: auth.adminId,
          note: checked.data.note ?? null,
        })
        if (historyInsert.error) return error(defaultMessage(500), 500, 'database')
      }

      const updated = await client
        .from('applications')
        .update({
          status: checked.data.status,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('*')
        .maybeSingle()
      if (updated.error) return error(defaultMessage(500), 500, 'database')

      let notificationStatus: 'pending' | 'skipped' = 'skipped'
      if (['accepted', 'rejected'].includes(checked.data.status)) {
        const queued = await client.from('notification_queue').insert({
          application_id: id,
          channel: 'discord',
          status: 'pending',
          payload: {
            tracking_no: current.data.tracking_no,
            status: checked.data.status,
          },
        })
        if (queued.error) return error(defaultMessage(500), 500, 'database')
        const marked = await client.from('applications').update({ notification_status: 'pending' }).eq('id', id)
        if (!marked.error) notificationStatus = 'pending'
      }

      await writeAudit(client, auth.adminId, 'application_status_change', 'applications', id, {
        from_status: current.data.status,
        to_status: checked.data.status,
      })
      return json({ ok: true, application: updated.data, notification_status: notificationStatus })
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
