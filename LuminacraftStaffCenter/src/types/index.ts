// Supabase Postgres şemasını yansıtan ortak tipler (snake_case alan adları).

export type QuestionType =
  | 'short_text'
  | 'long_text'
  | 'number'
  | 'single_choice'
  | 'multiple_choice'
  | 'yes_no'
  | 'checkbox'

export type ApplicationStatus = 'pending' | 'reviewing' | 'accepted' | 'rejected'

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

export interface Application {
  id: string
  tracking_no: string
  query_token: string
  position_slug: PositionSlug
  status: ApplicationStatus
  applicant_name: string
  applicant_email: string
  discord_username?: string | null
  discord_id?: string | null
  submitted_at?: string | null
  reviewed_at?: string | null
  total_score?: number | null
  created_at: string
  updated_at: string
}

export interface ApplicationAnswer {
  id?: string
  application_id: string
  question_id: string
  answer_text?: string | null
  answer_value?: string | null
  created_at?: string
}

export interface ApplicationScore {
  id?: string
  application_id: string
  criterion: ScoreCriterionKey
  score: number
  scored_by?: string | null
  created_at?: string
  updated_at?: string
}

export interface ApplicationNote {
  id: string
  application_id: string
  admin_id: string | null
  note: string
  created_at: string
}

export interface ApplicationHistory {
  id: string
  application_id: string
  from_status: ApplicationStatus | null
  to_status: ApplicationStatus
  changed_by?: string | null
  note?: string | null
  created_at: string
}

export interface AdminUser {
  id: string
  email: string
  display_name: string
  role: 'admin' | 'super_admin' | 'staff'
  is_active: boolean
  discord_id?: string | null
  last_login_at?: string | null
  created_at: string
}

export interface AdminSession {
  access_token: string
  refresh_token: string
  expires_at: number
  user: AdminUser
}

export interface DiscordLink {
  id?: string
  discord_id: string
  discord_username: string
  application_id?: string | null
  linked_at: string
}

export interface DiscordNotification {
  id?: string
  application_id: string
  channel: string
  status: 'pending' | 'sent' | 'failed'
  payload?: Record<string, unknown> | null
  error_message?: string | null
  created_at?: string
  sent_at?: string | null
}

export interface SystemSetting {
  key: string
  value: string | null
  description?: string | null
  updated_by?: string | null
  updated_at?: string
}

export interface AuditLog {
  id: string
  action: string
  entity_type: string
  entity_id: string | null
  admin_id: string | null
  details?: Record<string, unknown> | null
  created_at: string
}
