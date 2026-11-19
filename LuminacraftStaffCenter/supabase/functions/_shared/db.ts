// Yalnızca Edge Functions içinde kullanılan service_role veritabanı istemcisi.
// service_role anahtarı hiçbir yanıta veya tarayıcı koduna eklenmez.
import { buildAuditRow, env } from './pure.ts'

export const CONFIG_ERROR =
  'Sunucu yapılandırması eksik: SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY tanımlanmalı.'

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

/** Yönetici eylemini audit_logs tablosuna yazar; ana işlemi engellemez. */
export async function writeAudit(
  client: Client,
  adminId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    await client
      .from('audit_logs')
      .insert(buildAuditRow(adminId, action, entityType, entityId, details))
  } catch {
    // Denetim kaydı yazılamadı; kullanıcıya iç hata ayrıntısı gösterilmez.
  }
}
