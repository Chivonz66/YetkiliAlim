// Discord DM bildirimleri. Başarısızlık kararı geçersiz kılmaz; failed durumu döndürülür.
import { requireAdmin } from '../_shared/auth.ts'
import { preflight, withCors } from '../_shared/cors.ts'
import { getAdminClient } from '../_shared/db.ts'
import { canRetryNotification, env } from '../_shared/pure.ts'
import { defaultMessage, error, json } from '../_shared/responses.ts'
import { readJson, validate } from '../_shared/validation.ts'

const DISCORD_API = 'https://discord.com/api/v10'

type NotifyData = { application_id?: string; notification_id?: string }

function turkishMessage(trackingNo: string, status: string): string {
  const decision = status === 'accepted' ? 'kabul edildi' : 'reddedildi'
  return `Merhaba! ${trackingNo} numaralı Luminacraft ekip başvurunuz ${decision}. Bilgi ve geri bildirimler için ekip yöneticileriyle iletişime geçebilirsiniz.`
}

async function deliver(
  botToken: string,
  recipientId: string,
  content: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const channelResponse = await fetch(`${DISCORD_API}/users/@me/channels`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ recipient_id: recipientId }),
    })
    if (!channelResponse.ok) return { ok: false, error: 'Discord özel mesaj kanalı açılamadı.' }
    const channel = (await channelResponse.json()) as { id?: string }
    if (!channel.id) return { ok: false, error: 'Discord özel mesaj kanalı bulunamadı.' }

    const messageResponse = await fetch(`${DISCORD_API}/channels/${channel.id}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    })
    if (!messageResponse.ok) return { ok: false, error: 'Discord mesajı gönderilemedi.' }
    return { ok: true }
  } catch {
    return { ok: false, error: 'Discord servisine ulaşılamadı.' }
  }
}

async function mark(
  client: any,
  notificationId: string | null,
  applicationId: string,
  status: 'sent' | 'failed',
  message: string | null,
  attempts: number = 0,
): Promise<void> {
  try {
    if (notificationId) {
      await client
        .from('notification_queue')
        .update({
          status,
          last_error: message,
          attempts,
          sent_at: status === 'sent' ? new Date().toISOString() : null,
        })
        .eq('id', notificationId)
    }
    await client.from('applications').update({ notification_status: status }).eq('id', applicationId)
  } catch {
    // Durum güncellemesi başarısız olsa bile karar ve sonuç korunur.
  }
}

async function run(req: Request): Promise<Response> {
  const method = req.method
  const url = new URL(req.url)
  const auth = await requireAdmin(req, { csrf: method !== 'GET' })
  if (!auth.ok) return auth.response
  const db = await getAdminClient()
  if (!db.ok) return error(db.error, 503, 'configuration')
  const client = db.client

  const action = url.searchParams.get('action') ?? 'list'
  if (method === 'GET' && action === 'list') {
    let query = client.from('notification_queue').select('*').order('created_at', { ascending: false })
    const applicationId = url.searchParams.get('application_id')
    if (applicationId) query = query.eq('application_id', applicationId)
    const result = await query.limit(200)
    if (result.error) return error(defaultMessage(500), 500, 'database')
    return json({ ok: true, notifications: result.data ?? [] })
  }
  if (method !== 'POST') return error(defaultMessage(405), 405, 'method_not_allowed')

  const parsed = await readJson(req)
  if (!parsed.ok) return error(parsed.error, 400, 'invalid_body')
  const body = parsed.data as Record<string, unknown>
  const dataAction = typeof body.action === 'string' ? body.action : action
  if (dataAction !== 'send' && dataAction !== 'retry') {
    return error('Bilinmeyen işlem.', 400, 'unknown_action')
  }
  const checked = await validate<NotifyData>(
    'notify',
    dataAction === 'retry'
      ? { notification_id: body.notification_id }
      : { application_id: body.application_id },
  )
  if (!checked.ok) return error(checked.error, 400, 'validation')

  const botToken = env('DISCORD_BOT_TOKEN')
  if (!botToken) {
    return error('Discord bot belirteci yapılandırılmamış.', 503, 'configuration')
  }

  let notificationId: string | null = null
  let applicationId = ''
  let attempts = 0
  if (dataAction === 'retry') {
    const found = await client
      .from('notification_queue')
      .select('id, application_id, status, attempts')
      .eq('id', checked.data.notification_id)
      .maybeSingle()
    if (found.error) return error(defaultMessage(500), 500, 'database')
    if (!found.data) return error(defaultMessage(404), 404, 'not_found')
    // Yalnızca başarısız bildirimler yeniden denenebilir.
    if (!canRetryNotification(found.data.status)) {
      return error('Yalnızca başarısız bildirimler yeniden gönderilebilir.', 400, 'invalid_state')
    }
    notificationId = found.data.id
    applicationId = found.data.application_id
    attempts = Number(found.data.attempts ?? 0)
  } else {
    applicationId = checked.data.application_id ?? ''
    const existing = await client
      .from('notification_queue')
      .select('id, attempts')
      .eq('application_id', applicationId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (existing.data?.id) {
      notificationId = existing.data.id
      attempts = Number(existing.data.attempts ?? 0)
    } else {
      const created = await client
        .from('notification_queue')
        .insert({ application_id: applicationId, kind: 'discord', status: 'pending', payload: {} })
        .select('id')
        .single()
      if (created.error || !created.data) return error(defaultMessage(500), 500, 'database')
      notificationId = created.data.id
    }
  }

  const application = await client
    .from('applications')
    .select('id, tracking_no, status, discord_user_id')
    .eq('id', applicationId)
    .maybeSingle()
  if (application.error) return error(defaultMessage(500), 500, 'database')
  if (!application.data) return error(defaultMessage(404), 404, 'not_found')

  let recipientId = application.data.discord_user_id as string | null
  if (!recipientId) {
    const linked = await client
      .from('discord_links')
      .select('discord_user_id')
      .eq('application_id', applicationId)
      .maybeSingle()
    recipientId = linked.data?.discord_user_id ?? null
  }
  if (!recipientId) {
    const reason = 'Başvuruya bağlı Discord kullanıcısı bulunamadı.'
    await mark(client, notificationId, applicationId, 'failed', reason, attempts + 1)
    return json({ ok: true, notification_status: 'failed', error: reason, application_id: applicationId })
  }

  const result = await deliver(
    botToken,
    recipientId,
    turkishMessage(String(application.data.tracking_no ?? ''), String(application.data.status ?? '')),
  )
  if (!result.ok) {
    const reason = result.error ?? 'Discord bildirimi gönderilemedi.'
    await mark(client, notificationId, applicationId, 'failed', reason, attempts + 1)
    return json({ ok: true, notification_status: 'failed', error: reason, application_id: applicationId })
  }
  await mark(client, notificationId, applicationId, 'sent', null, attempts + 1)
  return json({ ok: true, notification_status: 'sent', application_id: applicationId })
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
