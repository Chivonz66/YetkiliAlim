import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeAudit } from '../supabase/functions/_shared/db.ts'

// Kaynak metin doğrulamaları canlı veritabanı veya ağ gerektirmez.
const oku = (relative: string): string => readFileSync(join(process.cwd(), relative), 'utf8')
const kod = (relative: string): string =>
  oku(relative).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const ADMIN = kod('supabase/functions/admin-applications/index.ts')
const DB = kod('supabase/functions/_shared/db.ts')
const VALIDATION = kod('supabase/functions/_shared/validation.ts')
const TETIKLEYICI = oku('supabase/migrations/0003_functions_triggers.sql')
const GOC6 = oku('supabase/migrations/0006_decision_notify.sql')
const GOC9 = oku('supabase/migrations/0009_remove_discord_integrations.sql')
const AYARLAR = kod('src/pages/admin/SettingsPage.tsx')
const DETAY = kod('src/pages/admin/ApplicationDetailPage.tsx')

const KALDIRILAN_TERIMLER =
  /discord-oauth|discord-notify|discord_link_token|discord_linked|discord_user_id|discord_connected|discord_enabled|oauth_state_hash|notification_queue|notification_status|buildDecisionMessage|sanitizeCandidateNote|decisionIdempotencyKey|canRetryNotification|DM bildirimi/i

afterEach(() => {
  vi.restoreAllMocks()
})

describe('YA-08 — karar kaydı bildirim kuyruğu olmadan tamamlanır', () => {
  it('karar yalnızca durum gerçekten değiştiğinde denetim kaydı üretir', () => {
    expect(ADMIN).toContain('const statusChanged = current.data.status !== checked.data.status')
    expect(ADMIN).toContain("client.rpc('apply_application_decision'")
    expect(ADMIN).toContain('...(auditWarning ? { audit_warning: auditWarning } : {})')
    expect(ADMIN).not.toContain("from('notification_queue')")
    expect(ADMIN).not.toContain('notification_status')
    expect(ADMIN).not.toContain('discord_enabled')
    expect(ADMIN).not.toContain('decisionIdempotencyKey')
  })

  it('0006 yer tutucudur; 0009 eski Discord/DM nesnelerini kaldırır', () => {
    expect(GOC6).toContain('yer tutucu')
    expect(GOC6).not.toContain('ALTER TABLE public.notification_queue')
    expect(GOC6).not.toContain('CREATE OR REPLACE FUNCTION public.claim_')

    expect(GOC9).toContain('DROP FUNCTION IF EXISTS public.claim_pending_notification(uuid)')
    expect(GOC9).toContain('DROP FUNCTION IF EXISTS public.claim_failed_notification(uuid)')
    expect(GOC9).toContain('DROP TABLE IF EXISTS public.notification_queue')
    expect(GOC9).toContain('DROP TABLE IF EXISTS public.discord_links')
    expect(GOC9).toContain('DROP COLUMN IF EXISTS discord_user_id')
    expect(GOC9).toContain('DROP COLUMN IF EXISTS discord_connected')
    expect(GOC9).toContain('DROP COLUMN IF EXISTS notification_status')
    expect(GOC9).toContain("DELETE FROM public.app_settings WHERE key = 'discord_enabled'")
    expect(GOC9).toContain('CREATE OR REPLACE FUNCTION public.submit_application_atomic(')
    expect(GOC9).toContain('CREATE OR REPLACE FUNCTION public.lookup_application(')
  })

  it('eski 5 bağımsız değişkenli RPC ve eski durum sorgusu kaldırılır', () => {
    expect(GOC9).toContain(
      'DROP FUNCTION IF EXISTS public.submit_application_atomic(jsonb, jsonb, text, text, text)',
    )
    expect(GOC9).toContain('DROP FUNCTION IF EXISTS public.lookup_application(text, text)')
    expect(GOC9).toContain('GRANT EXECUTE ON FUNCTION public.submit_application_atomic(jsonb, jsonb)')
    expect(GOC9).not.toContain('notification_status text')
  })
})

describe('YA-09 — karar notu yalnızca yönetici kaydıdır', () => {
  it('not yönetici notu olarak saklanır; başvurana DM şablonu üretilmez', () => {
    expect(ADMIN).toContain("from('application_notes').insert")
    expect(ADMIN).toContain('admin_id: auth.adminId')
    expect(ADMIN).toMatch(/application_id: id,\s*admin_id: auth\.adminId,\s*note,/)
    expect(ADMIN).not.toContain('notificationPayload.note')
    expect(ADMIN).not.toContain('buildDecisionMessage(')
    expect(ADMIN).not.toContain('sanitizeCandidateNote(')
  })

  it('yönetici detayında bildirim durumu veya bağlantı rozeti yoktur', () => {
    expect(DETAY).toContain('Discord kullanıcı adı')
    expect(DETAY).not.toMatch(KALDIRILAN_TERIMLER)
  })
})

describe('YA-12 — denetim hataları ve karar aktörü', () => {
  it('audit insert hatası yutulmaz; sonuç ve log üretir', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const client = {
      from: () => ({ insert: async () => ({ error: { message: 'insert denied' } }) }),
    } as any
    const result = await writeAudit(client, 'admin-1', 'decision_note_create', 'application_notes', 'app-1', {})
    expect(result.ok).toBe(false)
    expect(log).toHaveBeenCalledWith('[audit] write_failed', expect.any(String))
  })

  it('audit beklenmeyen hata fırlattığında da görünür olur', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const client = {
      from: () => ({
        insert: async () => {
          throw new Error('boom')
        },
      }),
    } as any
    const result = await writeAudit(client, null, 'admin_setup', 'admins', null, {})
    expect(result.ok).toBe(false)
    expect(log).toHaveBeenCalled()
  })

  it('karar, işlem kapsamlı aktör bağlamıyla uygulanır ve tek denetim kaydı yazılır', () => {
    expect(TETIKLEYICI).toContain("set_config('app.current_actor', p_decided_by::text, true)")
    expect(TETIKLEYICI).toContain('NEW.decided_by::text')
    expect(TETIKLEYICI).toContain('INSERT INTO public.application_history')
    expect(TETIKLEYICI).toContain('INSERT INTO public.audit_logs')
    expect(TETIKLEYICI).toContain('GRANT EXECUTE ON FUNCTION public.apply_application_decision')
    expect(ADMIN).toContain("client.rpc('apply_application_decision'")
    expect(ADMIN).not.toContain('application_status_change')
    expect(DB).toContain('return { ok: false, error: genericError }')
  })
})

describe('Discord hesabı bağlama ve DM bildirimleri kaldırıldı', () => {
  it('Edge ve yönetim kaynaklarında eski akışlara ait çağrı kalmaz', () => {
    const dosyalar = [
      ADMIN,
      DB,
      VALIDATION,
      kod('supabase/functions/submit-application/index.ts'),
      kod('supabase/functions/public-status/index.ts'),
      kod('supabase/functions/admin-settings/index.ts'),
      kod('supabase/functions/_shared/auth.ts'),
      kod('supabase/functions/_shared/pure.ts'),
      AYARLAR,
      DETAY,
      kod('src/pages/ApplyPage.tsx'),
      kod('src/lib/api-public.ts'),
      kod('src/lib/api-admin.ts'),
      kod('src/lib/constants.ts'),
    ]
    for (const kaynak of dosyalar) expect(kaynak).not.toMatch(KALDIRILAN_TERIMLER)
  })

  it('Discord kullanıcı adı zorunlu ve sunucuda biçim olarak doğrulanır', () => {
    expect(VALIDATION).toContain('Discord kullanıcı adı zorunludur.')
    expect(VALIDATION).toContain('/^[A-Za-z0-9_.]{3,32}$/')
    expect(kod('supabase/functions/submit-application/index.ts')).toContain(
      'applicant_discord_username: discord',
    )
    expect(AYARLAR).not.toMatch(/discord/i)
  })
})
