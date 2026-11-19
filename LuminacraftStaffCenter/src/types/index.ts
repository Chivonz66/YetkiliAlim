// Supabase Postgres şemasını yansıtan ortak tipler (snake_case alan adları).
// Kaynak: supabase/migrations/0001_initial_schema.sql. Question.type ve
// Position.is_open yalnızca istemci sözleşmesidir; Edge Functions çevirir.

export type QuestionType =
  | 'short_text'
  | 'long_text'
  | 'number'
  | 'single_choice'
  | 'multiple_choice'
  | 'yes_no'
  | 'checkbox'

export type ApplicationStatus = 'pending' | 'reviewing' | 'accepted' | 'rejected'

export type ApplicationNotificationStatus = 'none' | 'queued' | 'pending' | 'sent' | 'failed'

export type PositionSlug = 'rehber' | 'aac'

export type ScoreCriterionKey =
  | 'communication'
  | 'knowledge'
  | 'responsibility'
  | 'problem_solving'
  | 'experience'
  | 'position_fit'

export interface QuestionOption {
  id?: string
  question_id?: string
  label: string
  value: string
  sort_order: number
  is_active?: boolean
}

export interface QuestionCategory {
  id: string
  slug: string
  name: string
  description?: string | null
  sort_order: number
  is_active?: boolean
}

/** İstemci tarafındaki soru sözleşmesi; veritabanı sütunu `question_type`'tır. */
export interface Question {
  id: string
  category_id: string | null
  position_slug: PositionSlug | 'all' | null
  type: QuestionType
  question_text: string
  help_text?: string | null
  is_required: boolean
  is_active: boolean
  min_length?: number | null
  max_length?: number | null
  min_value?: number | null
  max_value?: number | null
  sort_order: number
  options?: QuestionOption[]
  created_at?: string
  updated_at?: string
}

/** İstemci tarafındaki pozisyon sözleşmesi; `is_open` DB sütunu değildir. */
export interface Position {
  id: string
  slug: PositionSlug
  name: string
  description?: string | null
  is_active: boolean
  sort_order: number
  created_at?: string
  updated_at?: string
}

/** applications tablosu. Ham sorgu anahtarı yalnızca hash olarak tutulur. */
export interface Application {
  id: string
  tracking_no: string
  query_token_hash: string
  position_slug: PositionSlug
  applicant_minecraft_username: string
  applicant_discord_username: string
  discord_user_id: string | null
  discord_connected: boolean
  age: number | null
  daily_hours: number | null
  minecraft_experience: string | null
  staff_experience: string | null
  self_introduction: string | null
  status: ApplicationStatus
  submitted_at: string
  updated_at: string
  decided_at: string | null
  decided_by: string | null
  notification_status: ApplicationNotificationStatus
  source_ip_hash: string | null
  /** Eski yönetim listesi sıralaması için `submitted_at` takma adı; DB sütunu değildir. */
  created_at?: string
}

/** application_answers tablosu; eski soruların anlık görüntüsünü de taşır. */
export interface ApplicationAnswer {
  id: string
  application_id: string
  question_id: string
  question_text: string
  question_type: QuestionType
  category_name: string | null
  position_slug: PositionSlug | 'all' | null
  options_snapshot: QuestionOption[]
  value: unknown
  created_at: string
}

/** application_scores tablosu; kriter başına tek satır ve ağırlık anlık görüntüsü. */
export interface ApplicationScore {
  id: string
  application_id: string
  criterion_key: ScoreCriterionKey
  points: number
  weight_snapshot: number
  scored_by: string | null
  created_at: string
  updated_at: string
}

/** application_notes tablosu. */
export interface ApplicationNote {
  id: string
  application_id: string
  admin_id: string | null
  note: string
  created_at: string
}

/** application_history tablosu; satırları 0003 tetikleyicisi yazar. */
export interface ApplicationHistory {
  id: string
  application_id: string
  from_status: ApplicationStatus | null
  to_status: ApplicationStatus
  action: string
  actor: string | null
  details: Record<string, unknown>
  created_at: string
}

/** admins tablosu. Parola özeti asla istemciye gönderilmez. */
export interface AdminUser {
  id: string
  username: string
  is_active: boolean
  created_at: string
  last_login_at: string | null
}

/** admin_sessions tablosu; oturum anahtarının yalnızca özeti tutulur. */
export interface AdminSession {
  token_hash: string
  admin_id: string
  csrf_token: string
  expires_at: string
  created_at: string
  revoked_at: string | null
}

/** discord_links tablosu. */
export interface DiscordLink {
  discord_user_id: string
  discord_username: string
  application_id: string | null
  linked_at: string
  oauth_state_hash: string | null
}

/** notification_queue tablosu. */
export interface DiscordNotification {
  id: string
  application_id: string
  discord_user_id: string | null
  kind: string
  payload: Record<string, unknown>
  status: 'pending' | 'sent' | 'failed'
  attempts: number
  last_error: string | null
  created_at: string
  sent_at: string | null
}

/** app_settings tablosu; value jsonb olduğu için tipi serbesttir. */
export interface SystemSetting {
  key: string
  value: unknown
  updated_at: string
}

/** audit_logs tablosu; append-only günlük. */
export interface AuditLog {
  id: string
  actor_type: 'admin' | 'system'
  actor_id: string | null
  action: string
  target_table: string | null
  target_id: string | null
  details: Record<string, unknown>
  ip_hash: string | null
  created_at: string
}
