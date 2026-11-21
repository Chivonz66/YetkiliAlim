// Yalnızca Edge Functions içinde kullanılan service_role veritabanı istemcisi.
// service_role anahtarı hiçbir yanıta veya tarayıcı koduna eklenmez.
import { buildAuditRow, env } from './pure.ts'

export const CONFIG_ERROR =
  'Sunucu yapılandırması eksik: SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY tanımlanmalı.'

/** Discord özelliğinin tek geçerli ayar anahtarı. */
export const DISCORD_ENABLED_SETTING = 'discord_enabled'

type Client = {
  from: (table: string) => any
  rpc: (name: string, params?: Record<string, unknown>) => any
}

let cached: Promise<Client> | null = null

export function getConfig(): { url: string | undefined; serviceKey: string | undefined } {
  return {
    url: env('SUPABASE_URL') ?? env('VITE_SUPABASE_URL'),
    serviceKey: env('SUPABASE_SERVICE_ROLE_KEY'),
  }
}

export function isConfigured(): boolean {
  const { url, serviceKey } = getConfig()
  return Boolean(url && serviceKey)
}

export async function getAdminClient(): Promise<
  { ok: true; client: Client } | { ok: false; error: string }
> {
  const { url, serviceKey } = getConfig()
  if (!url || !serviceKey) return { ok: false, error: CONFIG_ERROR }
  if (!cached) {
    // @ts-ignore Uzak modül yalnızca Deno çalışma zamanında çözümlenir.
    cached = import('https://esm.sh/@supabase/supabase-js@2')
      .then(({ createClient }) =>
        createClient(url, serviceKey, { auth: { persistSession: false } }) as unknown as Client,
      )
      .catch((cause) => {
        cached = null
        throw cause
      })
  }
  try {
    return { ok: true, client: await cached }
  } catch {
    return { ok: false, error: 'Veritabanı bağlantısı kurulamadı.' }
  }
}

/** Yalnızca discord_enabled açıkça doğruysa bildirim üretilir/gönderilir. */
export function isDiscordEnabledSetting(
  rows: Array<{ key?: string; value?: unknown }> | null | undefined,
): boolean {
  const row = rows?.find((item) => item?.key === DISCORD_ENABLED_SETTING)
  const value = row?.value
  return value === true || value === 'true' || value === 1
}

/** Aynı kararın ikinci kez kuyruğa alınmasını engelleyen doğal anahtar. */
export function decisionIdempotencyKey(
  applicationId: string,
  status: string,
  decidedAt: string,
): string {
  return `decision:${applicationId}:${status}:${decidedAt}`
}

/**
 * Karar notunun başvurana gösterilecek kopyası. Ekip notu ham hâliyle
 * saklanır; DM yalnızca bu süzülmüş, sınırlı kopyayı kullanır.
 */
export function sanitizeCandidateNote(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/<@[!&]?\d+>/g, '')
    .replace(/<#\d+>/g, '')
    .replace(/@(everyone|here)\b/gi, '$1')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500)
}

/** Karar sonucu ve isteğe bağlı geri bildirim için sabit Türkçe DM şablonu. */
export function buildDecisionMessage(
  trackingNo: string,
  status: string,
  note?: unknown,
): string {
  const decision = status === 'accepted' ? 'kabul edildi' : 'reddedildi'
  const feedback = sanitizeCandidateNote(note)
  const detail = feedback ? ` Karar notu: ${feedback}.` : ''
  return `Merhaba! ${trackingNo} numaralı Luminacraft ekip başvurunuz ${decision}.${detail} Bilgi ve geri bildirimler için ekip yöneticileriyle iletişime geçebilirsiniz.`
}

export type AuditWriteResult = { ok: true } | { ok: false; error: string }

/**
 * Yönetici eylemini audit_logs tablosuna yazar; ana işlemi engellemez.
 * Hata yutulmaz: yapılandırılmış Edge log'u ve çağırana sonuç döndürülür.
 */
export async function writeAudit(
  client: Client,
  adminId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  details: Record<string, unknown> = {},
): Promise<AuditWriteResult> {
  const genericError = 'Denetim kaydı yazılamadı; işlem günlüğe alınamadı.'
  try {
    const result = await client
      .from('audit_logs')
      .insert(buildAuditRow(adminId, action, entityType, entityId, details))
    if (result?.error) {
      console.error(
        '[audit] write_failed',
        JSON.stringify({ action, target_table: entityType, detail: result.error.message ?? result.error }),
      )
      return { ok: false, error: genericError }
    }
    return { ok: true }
  } catch (cause) {
    console.error(
      '[audit] write_failed',
      JSON.stringify({ action, target_table: entityType, detail: cause instanceof Error ? cause.message : cause }),
    )
    return { ok: false, error: genericError }
  }
}
