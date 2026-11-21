import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildDecisionMessage,
  decisionIdempotencyKey,
  isDiscordEnabledSetting,
  sanitizeCandidateNote,
  writeAudit,
} from '../supabase/functions/_shared/db.ts'

// Kaynak metin doğrulamaları canlı veritabanı veya ağ gerektirmez.
const oku = (relative: string): string => readFileSync(join(process.cwd(), relative), 'utf8')
const kod = (relative: string): string =>
  oku(relative).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const ADMIN = kod('supabase/functions/admin-applications/index.ts')
const NOTIFY = kod('supabase/functions/discord-notify/index.ts')
const DB = kod('supabase/functions/_shared/db.ts')
const TETIKLEYICI = oku('supabase/migrations/0003_functions_triggers.sql')
const GOC6 = oku('supabase/migrations/0006_decision_notify.sql')
const AYARLAR = kod('src/pages/admin/SettingsPage.tsx')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('YA-08 — karar bildirimi tekilleştirmesi', () => {
  it('idempotency anahtarı aynı karar için kararlı, farklı karar için benzersizdir', () => {
    const bir = decisionIdempotencyKey('app-1', 'accepted', '2026-01-01T00:00:00.000Z')
    expect(bir).toBe('decision:app-1:accepted:2026-01-01T00:00:00.000Z')
    expect(decisionIdempotencyKey('app-1', 'accepted', '2026-01-01T00:00:00.000Z')).toBe(bir)
    expect(decisionIdempotencyKey('app-1', 'rejected', '2026-01-01T00:00:00.000Z')).not.toBe(bir)
    expect(decisionIdempotencyKey('app-2', 'accepted', '2026-01-01T00:00:00.000Z')).not.toBe(bir)
  })

  it('karar uç noktası yalnızca durum gerçekten değiştiğinde kuyruk oluşturur', () => {
    expect(ADMIN).toContain('const statusChanged = current.data.status !== checked.data.status')
    expect(ADMIN).toContain('if (statusChanged && finalStatus)')
    expect(ADMIN).toContain("from('notification_queue').insert")
    expect(ADMIN).toContain(
      'idempotency_key: decisionIdempotencyKey(id, checked.data.status, decision.decided_at)',
    )
    expect(ADMIN).toContain("status: 'pending'")
    expect(ADMIN).toContain("notification_status: 'pending'")
  })

  it('0006 göçü kuyruğa benzersiz anahtar ve tek bekleyen satır kısıtı ekler', () => {
    expect(GOC6).toContain('ADD COLUMN IF NOT EXISTS idempotency_key text')
    expect(GOC6).toContain('CREATE UNIQUE INDEX IF NOT EXISTS notification_queue_idempotency_key_unique')
    expect(GOC6).toContain('CREATE UNIQUE INDEX IF NOT EXISTS notification_queue_one_pending_per_application')
    expect(GOC6).toContain("WHERE status = 'pending'")
    expect(GOC6).toContain('FOR UPDATE SKIP LOCKED')
    expect(GOC6).toContain('claim_pending_notification')
    expect(GOC6).toContain('claim_failed_notification')
  })

  it('gönderim, yeni kuyruk satırı açmadan tek bir bekleyen satırı kilitler', () => {
    expect(NOTIFY).toContain("client.rpc('claim_pending_notification'")
    expect(NOTIFY).toContain("client.rpc('claim_failed_notification'")
    expect(NOTIFY).toContain('claimed_at: null')
    expect(NOTIFY).not.toMatch(/\.from\('notification_queue'\)\s*\.insert/)
  })
})

describe('YA-09 — karar notunun saklanması ve kullanılması', () => {
  it('not yönetici kaydı olarak saklanır ve kuyruk yükünde taşınır', () => {
    expect(ADMIN).toContain("from('application_notes').insert")
    expect(ADMIN).toContain('admin_id: auth.adminId')
    expect(ADMIN).toContain('...(note ? { note } : {})')
    expect(NOTIFY).toContain('notificationPayload.note')
    expect(NOTIFY).toContain('buildDecisionMessage(')
  })

  it('DM şablonu Türkçe ve sabit yapıdadır; not ayrı bir satırda gösterilir', () => {
    const withNote = buildDecisionMessage('LSC-2026-A2B3C4', 'accepted', 'Başvurunuz incelendi.')
    expect(withNote).toContain('LSC-2026-A2B3C4 numaralı Luminacraft ekip başvurunuz kabul edildi.')
    expect(withNote).toContain('Karar notu: Başvurunuz incelendi.')
    expect(withNote).toContain('Bilgi ve geri bildirimler için ekip yöneticileriyle iletişime geçebilirsiniz.')

    const withoutNote = buildDecisionMessage('LSC-2026-A2B3C4', 'rejected', '')
    expect(withoutNote).toContain('reddedildi')
    expect(withoutNote).not.toContain('Karar notu')
  })

  it('başvurana giden not kopyası Discord özel içeriklerinden arındırılır', () => {
    expect(sanitizeCandidateNote('  @everyone https://example.com  kabul\n edildi  ')).toBe(
      'everyone kabul edildi',
    )
    expect(sanitizeCandidateNote('<@123456789> <#987654321> merhaba')).toBe('merhaba')
    expect(sanitizeCandidateNote('x'.repeat(900))).toHaveLength(500)
    expect(buildDecisionMessage('LSC-2026-A2B3C4', 'accepted', '@everyone')).not.toContain('@everyone')
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

describe('YA-13 — discord_enabled kapısı', () => {
  it('yalnızca tam discord_enabled anahtarı ve doğru değer etkin sayılır', () => {
    expect(isDiscordEnabledSetting([{ key: 'discord_enabled', value: true }])).toBe(true)
    expect(isDiscordEnabledSetting([{ key: 'discord_enabled', value: 'true' }])).toBe(true)
    expect(isDiscordEnabledSetting([{ key: 'discord_enabled', value: false }])).toBe(false)
    expect(isDiscordEnabledSetting([{ key: 'discord_enabled', value: 'false' }])).toBe(false)
    expect(isDiscordEnabledSetting([{ key: 'other_discord_enabled', value: true }])).toBe(false)
    expect(isDiscordEnabledSetting([])).toBe(false)
  })

  it('kuyruk oluşturma ve gönderim aynı ayar anahtarına bağlıdır', () => {
    expect(ADMIN).toContain(".eq('key', 'discord_enabled')")
    expect(NOTIFY).toContain(".eq('key', 'discord_enabled')")
    expect(ADMIN).toContain('if (await discordEnabled(client))')
    expect(NOTIFY).toContain('if (!(await discordEnabled(client)))')
    expect(ADMIN.indexOf("'discord_enabled'")).toBeLessThan(ADMIN.indexOf("from('notification_queue').insert"))
    expect(NOTIFY.indexOf("'discord_enabled'")).toBeLessThan(NOTIFY.indexOf("client.rpc('claim_pending_notification'"))
    expect(AYARLAR).toContain(
      'hint="Kapalıyken kabul/red kararları için kuyruk oluşturulmaz; gönderim ve yeniden gönderim engellenir."',
    )
  })

  it('alıcı araması başvuru ve bağlantı tablolarında korunur', () => {
    expect(NOTIFY).toContain('application.data.discord_user_id')
    expect(NOTIFY).toContain("from('discord_links')")
    expect(NOTIFY).toContain(".eq('application_id', applicationId)")
  })
})
