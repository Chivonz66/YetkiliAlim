import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  Application,
  ApplicationAnswer,
  ApplicationHistory,
  ApplicationScore,
  DiscordLink,
  DiscordNotification,
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
  it('başvuru gönderimi şema alanlarını ve rate limit anahtarını kullanır', () => {
    const code = kod(`${EDGE}/submit-application/index.ts`)
    expect(code).toContain('applicant_minecraft_username: minecraft')
    expect(code).toContain('applicant_discord_username: discord')
    expect(code).toContain('daily_hours:')
    expect(code).toContain('query_token_hash: tokenHash')
    expect(code).toContain("from('rate_limits')")
    expect(code).toContain("onConflict: 'key,window_start'")
    expect(code).toContain('hit_count')
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
      'notification_status',
      'status_history',
    ]) {
      expect(code, alan).toContain(`'${alan}'`)
    }
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
    expect(code).toContain("from('notification_queue').insert")
    expect(code).toContain("status: 'pending'")
    expect(code).toContain("notification_status: 'pending'")
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

  it('pozisyon güncellemeleri is_open alanını veritabanına göndermez', () => {
    const code = kod(`${EDGE}/admin-positions/index.ts`)
    expect(code).toContain('const { is_open: _ignored, ...rest } = fields')
    expect(code).not.toMatch(/\.update\(\{[^}]*\bis_open\b/s)
    expect(code).not.toMatch(/\.insert\(\{[^}]*\bis_open\b/s)
  })

  it('uygulama ayarları jsonb değerini dönüştürmeden saklar', () => {
    const code = kod(`${EDGE}/admin-settings/index.ts`)
    expect(code).toContain('value: value ?? null')
    expect(code).toContain("onConflict: 'key'")
    expect(code).not.toContain('updated_by')
  })

  it('Discord bildirim kuyruğu attempts, last_error ve sent_at kullanır', () => {
    const code = kod(`${EDGE}/discord-notify/index.ts`)
    expect(code).toContain('last_error: message')
    expect(code).toContain('attempts,')
    expect(code).toContain('sent_at: status ===')
    expect(code).toContain('canRetryNotification(found.data.status)')
    expect(code).toContain('Yalnızca başarısız bildirimler yeniden gönderilebilir.')
    expect(code).not.toMatch(/\.from\('applications'\)\s*\.update\(\{\s*status/)
  })

  it('Discord OAuth durumu imzalanır ve doğal anahtarla kaydedilir', () => {
    const code = kod(`${EDGE}/discord-oauth/index.ts`)
    expect(code).toContain("env('SESSION_SECRET')")
    expect(code).toContain('hmacSha256Hex')
    expect(code).toContain('oauth_state_hash: hash')
    expect(code).toContain("onConflict: 'discord_user_id'")
    expect(code).toContain("eq('oauth_state_hash', hash)")
    expect(code).not.toMatch(/\bstate_hash\s*:|\bdiscord_id\s*:/)
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
      true satisfies AlanVar<DiscordNotification, 'last_error'>,
      true satisfies AlanVar<DiscordLink, 'oauth_state_hash'>,
      true satisfies AlanVar<Question, 'type'>,
    ]
    const yokMu: Array<false> = [
      false satisfies AlanVar<Application, 'applicant_name'>,
      false satisfies AlanVar<ApplicationAnswer, 'answer_text'>,
      false satisfies AlanVar<ApplicationScore, 'criterion'>,
      false satisfies AlanVar<ApplicationHistory, 'changed_by'>,
      false satisfies AlanVar<DiscordNotification, 'error_message'>,
      false satisfies AlanVar<DiscordLink, 'state_hash'>,
    ]
    expect(varMi).toHaveLength(10)
    expect(yokMu).toHaveLength(6)
  })

  it('yönetici ekranları şema alanlarını okur', () => {
    const detail = kod('src/pages/admin/ApplicationDetailPage.tsx')
    const table = kod('src/components/admin/ApplicationTable.tsx')
    const scores = kod('src/components/admin/ScorePanel.tsx')
    const timeline = kod('src/components/admin/AuditTimeline.tsx')
    expect(detail).toContain('application.applicant_minecraft_username')
    expect(detail).toContain('answer.value')
    expect(detail).toContain('item.last_error')
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
      `${EDGE}/discord-notify/index.ts`,
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
  expect(sema).toContain('oauth_state_hash')
  expect(guvenlik).toContain('lookup_application')
  expect(guvenlik).toContain('p_query_token')
})
