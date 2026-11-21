// Başvuru listesi/detayı ve karar kaydı. Karar, bildirim kuyruğuna eklenir.
import { requireAdmin } from '../_shared/auth.ts'
import { preflight, withCors } from '../_shared/cors.ts'
import {
  decisionIdempotencyKey,
  getAdminClient,
  isDiscordEnabledSetting,
  writeAudit,
} from '../_shared/db.ts'
import { defaultMessage, error, json } from '../_shared/responses.ts'
import { readJson, validate } from '../_shared/validation.ts'

type DecisionData = { status: 'pending' | 'reviewing' | 'accepted' | 'rejected'; note?: string }

function safeSearch(value: string): string {
  return value.replace(/[,()%\\]/g, ' ').trim().slice(0, 100)
}

/** Aynı kuyruk satırının benzersizlik hatasını tanır. */
function isDuplicateQueueRow(queued: any): boolean {
  return queued?.error?.code === '23505' || /duplicate key|unique constraint/i.test(String(queued?.error?.message ?? ''))
}

async function discordEnabled(client: any): Promise<boolean> {
  const setting = await client
    .from('app_settings')
    .select('key, value')
    .eq('key', 'discord_enabled')
    .maybeSingle()
  if (setting.error) return false
  return isDiscordEnabledSetting(setting.data ? [setting.data] : [])
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
      const finalStatus = ['accepted', 'rejected'].includes(checked.data.status)
      const note = typeof checked.data.note === 'string' ? checked.data.note.trim() : ''
      let application = current.data
      let notificationStatus: 'pending' | 'skipped' = 'skipped'
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

      if (statusChanged && finalStatus) {
        if (await discordEnabled(client)) {
          const linked = await client
            .from('discord_links')
            .select('discord_user_id')
            .eq('application_id', id)
            .maybeSingle()
          const queued = await client.from('notification_queue').insert({
            application_id: id,
            discord_user_id: linked.data?.discord_user_id ?? null,
            kind: 'discord',
            status: 'pending',
            idempotency_key: decisionIdempotencyKey(id, checked.data.status, decision.decided_at),
            payload: {
              tracking_no: current.data.tracking_no,
              status: checked.data.status,
              ...(note ? { note } : {}),
            },
          })
          if (queued.error && !isDuplicateQueueRow(queued)) {
            return error(defaultMessage(500), 500, 'database')
          }
          if (!queued.error) {
            const marked = await client.from('applications').update({ notification_status: 'pending' }).eq('id', id)
            if (marked.error) return error(defaultMessage(500), 500, 'database')
          }
          notificationStatus = 'pending'
        } else {
          const cleared = await client.from('applications').update({ notification_status: 'none' }).eq('id', id)
          if (cleared.error) return error(defaultMessage(500), 500, 'database')
          application = { ...application, notification_status: 'none' }
        }
      }

      return json({
        ok: true,
        application,
        notification_status: notificationStatus,
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
