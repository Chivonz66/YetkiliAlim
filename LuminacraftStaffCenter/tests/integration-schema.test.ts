import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  Application,
  ApplicationAnswer,
  ApplicationHistory,
  ApplicationScore,
  Question,
} from '../src/types'

// Canlı veritabanı, Supabase istemcisi veya ağ gerekmez: yalnızca kaynak metin ve tipler okunur.
// jsdom altında import.meta.url dosya adresi olmadığı için proje kökü çalışma dizininden bulunur.
function projeKokunuBul(): string {
  let dizin = process.cwd()
  for (let adim = 0; adim < 5; adim += 1) {
    if (existsSync(join(dizin, 'supabase/migrations/0001_initial_schema.sql'))) return dizin
    const ust = join(dizin, '..')
    if (ust === dizin) break
    dizin = ust
  }
  throw new Error('Luminacraft Staff Center proje kökü bulunamadı.')
}

const kok = projeKokunuBul()
const oku = (goreliYol: string): string => readFileSync(join(kok, goreliYol), 'utf8')
const kod = (goreliYol: string): string =>
  oku(goreliYol).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const EDGE = 'supabase/functions'

/** Derleme zamanında alan varlığını/yokluğunu doğrular. */
type AlanVar<T, K extends PropertyKey> = K extends keyof T ? true : false

describe('Edge Function veritabanı sözleşmesi', () => {
  it('başvuru gönderimi şema alanlarını ve atomik RPC sözleşmesini kullanır', () => {
    const code = kod(`${EDGE}/submit-application/index.ts`)
    expect(code).toContain('applicant_minecraft_username: minecraft')
    expect(code).toContain('applicant_discord_username: discord')
    expect(code).toContain('daily_hours:')
    expect(code).toContain('query_token_hash: tokenHash')
    expect(code).toContain("rpc('increment_rate_limit'")
    expect(code).toContain("rpc('submit_application_atomic'")
    expect(code).toContain('p_key: key')
    expect(code).toContain('p_window_start: windowStart.toISOString()')
    expect(code).toContain('p_limit: limit')
    expect(code).toContain('p_answers: answerRows')
    expect(code).not.toContain('p_discord_user_id')
    expect(code).not.toContain('discord_link_token')
    expect(code).not.toMatch(/\.from\('rate_limits'\)/)
    expect(code).not.toMatch(/\.from\('applications'\)\s*\.insert/)
    expect(code).not.toMatch(/\.from\('application_answers'\)\s*\.insert/)
  })

  it('cevaplar question_type ve jsonb value alanlarıyla yazılır', () => {
    const code = kod(`${EDGE}/submit-application/index.ts`)
    expect(code).toContain('question_type: question.question_type')
    expect(code).toContain('value: submitted[question.id] ?? null')
    expect(code).not.toMatch(/\banswer_text\b|\banswer_value\b/)
  })

  it('herkese açık durum sorgusu doğru RPC parametrelerini ve güvenli alanları kullanır', () => {
    const code = kod(`${EDGE}/public-status/index.ts`)
    expect(code).toContain("rpc('lookup_application'")
    expect(code).toContain('p_tracking_no: checked.data.tracking_no')
    expect(code).toContain('p_query_token: checked.data.query_token')
    for (const alan of [
      'tracking_no',
      'position_slug',
      'status',
      'submitted_at',
      'decided_at',
      'status_history',
    ]) {
      expect(code, alan).toContain(`'${alan}'`)
    }
    expect(code).not.toContain("'notification_status'")
    expect(code).toContain('safe.decision_date = safe.decided_at')
    expect(code).not.toContain("'query_token'")
    expect(code).not.toMatch(/safe\.query_token\s*=/)
  })

  it('yönetici kararı şema sütunlarını yazar ve geçmişi tetiğe bırakır', () => {
    const code = kod(`${EDGE}/admin-applications/index.ts`)
    expect(code).toContain('applicant_minecraft_username.ilike')
    expect(code).toContain('applicant_discord_username.ilike')
    expect(code).toContain(".order('submitted_at'")
    expect(code).toContain('decided_at: new Date().toISOString()')
    expect(code).toContain('decided_by: auth.adminId')
    expect(code).not.toMatch(/from\('application_history'\)\s*\.insert/)
    expect(code).toContain("client.rpc('apply_application_decision'")
    expect(code).not.toContain("from('notification_queue')")
    expect(code).not.toContain('notification_status')
    expect(code).not.toContain('discord_enabled')
  })

  it('puanlar criterion_key ve weight_snapshot ile tek satıra yazılır', () => {
    const code = kod(`${EDGE}/admin-scores/index.ts`)
    expect(code).toContain("select('criterion_key, weight')")
    expect(code).toContain("onConflict: 'application_id,criterion_key'")
    expect(code).toContain('weight_snapshot:')
    expect(code).toContain('points:')
    expect(code).not.toMatch(/update\(\{\s*total_score/)
  })

  it('soru tipi istemci ve veritabanı adları arasında çevrilir', () => {
    const code = kod(`${EDGE}/admin-questions/index.ts`)
    expect(code).toContain('question_type: type')
    expect(code).toContain('type: question_type')
    expect(code).toContain('const { question_type, ...rest } = row')
  })

  it('pozisyon is_open değerini kanonik app_settings anahtarına yazar', () => {
    const code = kod(`${EDGE}/admin-positions/index.ts`)
    expect(code).toContain("requireAdmin(req, { csrf: method !== 'GET' })")
    expect(code).toContain('const { is_open: _ignored, ...rest } = fields')
    expect(code).not.toMatch(/\.update\(\{[^}]*\bis_open\b/s)
    expect(code).not.toMatch(/\.insert\(\{[^}]*\bis_open\b/s)
    expect(code).toContain('return `${slug}_applications_open`')
    expect(code).toContain("from('app_settings').upsert")
    expect(code).toContain('key: applicationOpenKey(slug)')
    expect(code).toContain('value: isOpen')
    expect(code).toContain("onConflict: 'key'")
    expect(code).toContain('is_open: openFlags[String(position.slug)] ?? true')
  })

  it('uygulama ayarları jsonb değerini dönüştürmeden saklar', () => {
    const code = kod(`${EDGE}/admin-settings/index.ts`)
    expect(code).toContain('value: value ?? null')
    expect(code).toContain("onConflict: 'key'")
    expect(code).not.toContain('updated_by')
  })

  it('discord-oauth ve discord-notify uçları kaldırıldı', () => {
    expect(existsSync(join(kok, `${EDGE}/discord-oauth/index.ts`))).toBe(false)
    expect(existsSync(join(kok, `${EDGE}/discord-notify/index.ts`))).toBe(false)

    const kaynaklar = [
      `${EDGE}/submit-application/index.ts`,
      `${EDGE}/admin-applications/index.ts`,
      `${EDGE}/public-status/index.ts`,
      `${EDGE}/admin-settings/index.ts`,
      `${EDGE}/_shared/auth.ts`,
      `${EDGE}/_shared/db.ts`,
      `${EDGE}/_shared/pure.ts`,
      `${EDGE}/_shared/validation.ts`,
    ]
    for (const dosya of kaynaklar) {
      expect(kod(dosya), dosya).not.toMatch(
        /discord-oauth|discord-notify|discord_link_token|discord_user_id|discord_connected|discord_enabled|oauth_state_hash|notification_queue|notification_status|canRetryNotification/i,
      )
    }
  })

  it('başvuru gönderimi pozisyon açıklığını ve zorunlu Discord adını sunucuda doğrular', () => {
    const code = kod(`${EDGE}/submit-application/index.ts`)
    const validation = kod(`${EDGE}/_shared/validation.ts`)
    expect(code).toContain('${data.position_slug}_applications_open')
    expect(code).toContain("'position_closed'")
    expect(code).toContain('applicant_discord_username: discord')
    expect(validation).toContain('Discord kullanıcı adı zorunludur.')
    expect(validation).toContain('/^[A-Za-z0-9_.]{3,32}$/')
    expect(code).not.toMatch(/verifySessionToken|discord-link:|discord_link_token/)
    expect(code).toContain('values.length > 0 && typeof answer ===')
    expect(code).not.toMatch(/values\.length === 0 \|\|/)
  })

  it('0005 göçü atomik başvuru ve hız sınırı fonksiyonlarını tanımlar', () => {
    const sql = oku('supabase/migrations/0005_submit_atomic.sql')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.submit_application_atomic(')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.increment_rate_limit(')
    expect(sql).toContain('INSERT INTO public.applications (')
    expect(sql).toContain('INSERT INTO public.application_answers (')
    expect(sql).toContain('ON CONFLICT (key, window_start)')
    expect(sql).toContain('RETURNING hit_count INTO v_hit_count')
    expect(sql).toContain('p_application jsonb,')
    expect(sql).toContain('p_answers jsonb')
    expect(sql).not.toContain('discord_links')
    expect(sql).not.toContain('notification_queue')
    expect(sql).toMatch(/SECURITY DEFINER/)
  })

  it('0009 göçü eski Discord/DM nesnelerini kaldırır ve durum sorgusunu sadeleştirir', () => {
    const sql = oku('supabase/migrations/0009_remove_discord_integrations.sql')
    expect(sql).toContain('DROP TABLE IF EXISTS public.discord_links')
    expect(sql).toContain('DROP TABLE IF EXISTS public.notification_queue')
    expect(sql).toContain('DROP COLUMN IF EXISTS notification_status')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.lookup_application(')
    expect(sql).not.toMatch(/\bnotification_status text\b/)
    expect(sql).not.toMatch(/INSERT INTO public\.(discord_links|notification_queue)/)
  })

  it('denetim yazımı audit_logs şema sütunlarını kullanır', () => {
    const db = kod(`${EDGE}/_shared/db.ts`)
    const pure = kod(`${EDGE}/_shared/pure.ts`)
    expect(db).toContain("from('audit_logs')")
    expect(db).toContain('buildAuditRow(')
    expect(pure).toContain("actor_type: adminId ? 'admin' : 'system'")
    expect(pure).toContain('target_table: entityType')
    expect(pure).toContain('target_id: entityId')
  })
})

describe('paylaşılan tipler ve yönetici arayüzü', () => {
  it('tipler veritabanı alan adlarını derleme zamanında zorunlu kılar', () => {
    const varMi: Array<true> = [
      true satisfies AlanVar<Application, 'applicant_minecraft_username'>,
      true satisfies AlanVar<Application, 'submitted_at'>,
      true satisfies AlanVar<Application, 'query_token_hash'>,
      true satisfies AlanVar<ApplicationAnswer, 'value'>,
      true satisfies AlanVar<ApplicationScore, 'criterion_key'>,
      true satisfies AlanVar<ApplicationScore, 'weight_snapshot'>,
      true satisfies AlanVar<ApplicationHistory, 'actor'>,
      true satisfies AlanVar<Application, 'applicant_discord_username'>,
      true satisfies AlanVar<Question, 'type'>,
    ]
    const yokMu: Array<false> = [
      false satisfies AlanVar<Application, 'applicant_name'>,
      false satisfies AlanVar<ApplicationAnswer, 'answer_text'>,
      false satisfies AlanVar<ApplicationScore, 'criterion'>,
      false satisfies AlanVar<ApplicationHistory, 'changed_by'>,
      false satisfies AlanVar<Application, 'discord_user_id'>,
      false satisfies AlanVar<Application, 'notification_status'>,
    ]
    expect(varMi).toHaveLength(9)
    expect(yokMu).toHaveLength(6)
  })

  it('yönetici ekranları şema alanlarını okur', () => {
    const detail = kod('src/pages/admin/ApplicationDetailPage.tsx')
    const table = kod('src/components/admin/ApplicationTable.tsx')
    const scores = kod('src/components/admin/ScorePanel.tsx')
    const timeline = kod('src/components/admin/AuditTimeline.tsx')
    expect(detail).toContain('application.applicant_minecraft_username')
    expect(detail).toContain('application.applicant_discord_username')
    expect(detail).toContain('answer.value')
    expect(detail).not.toMatch(/notification_status|discord_user_id|Discord bildirimi/i)
    expect(table).toContain("'applicant_minecraft_username'")
    expect(table).toContain("'submitted_at'")
    expect(scores).toContain('score.criterion_key')
    expect(scores).toContain('score.points')
    expect(timeline).toContain('entry.to_status')
    expect(timeline).toContain('entry.actor')
    expect(timeline).toContain('entry.details')
  })

  it('sahipliği yapılan kaynaklarda eski veritabanı alan adları kalmaz', () => {
    const dosyalar = [
      `${EDGE}/admin-applications/index.ts`,
      `${EDGE}/admin-scores/index.ts`,
      `${EDGE}/admin-questions/index.ts`,
      `${EDGE}/admin-positions/index.ts`,
      `${EDGE}/admin-settings/index.ts`,
      `${EDGE}/public-status/index.ts`,
      'src/types/index.ts',
      'src/pages/admin/ApplicationDetailPage.tsx',
      'src/components/admin/ApplicationTable.tsx',
      'src/components/admin/ScorePanel.tsx',
      'src/components/admin/AuditTimeline.tsx',
    ]
    const eskiAlanlar = [
      'applicant_name',
      'applicant_email',
      'answer_text',
      'answer_value',
      'error_message',
      'changed_by',
      'discord_id',
      'state_hash',
      'discord_user_id',
      'discord_connected',
      'notification_status',
    ]
    for (const dosya of dosyalar) {
      const source = kod(dosya)
      for (const alan of eskiAlanlar) {
        expect(source, `${dosya}: ${alan}`).not.toMatch(new RegExp(`\\b${alan}\\b`))
      }
    }
  })

  it('ana sayfa ikon tipini PositionSlug ile eşler', () => {
    const home = kod('src/pages/HomePage.tsx')
    expect(home).toContain("import type { LucideIcon } from 'lucide-react'")
    expect(home).toContain('Record<PositionSlug, LucideIcon>')
  })
})

it('SQL şeması kaynak metin olarak doğrulanır; canlı bağlantı gerekmez', () => {
  const sema = oku('supabase/migrations/0001_initial_schema.sql')
  const guvenlik = oku('supabase/migrations/0002_rls_policies.sql')
  for (const alan of [
    'tracking_no',
    'query_token_hash',
    'applicant_minecraft_username',
    'applicant_discord_username',
    'daily_hours',
    'submitted_at',
    'decided_at',
    'decided_by',
  ]) {
    expect(sema, alan).toContain(alan)
  }
  expect(sema).toContain('question_type')
  expect(sema).toContain('weight_snapshot')
  expect(sema).not.toContain('oauth_state_hash')
  expect(sema).not.toContain('notification_status')
  expect(guvenlik).toContain('lookup_application')
  expect(guvenlik).toContain('p_query_token')
  expect(guvenlik).not.toContain('notification_status')
})
