/**
 * Yönetim panelinin Edge Function erişim katmanı.
 *
 * Tüm istekler anonim anahtar, httpOnly oturum çerezi (credentials: include)
 * ve okunabilir CSRF çerezi ile yapılır. service_role anahtarı tarayıcıya
 * asla gönderilmez. Supabase modülü, saf yardımcılar içe aktarıldığında
 * istemci oluşturulmasın diye dinamik olarak yüklenir.
 */
import type {
  Application,
  ApplicationAnswer,
  ApplicationHistory,
  ApplicationNote,
  ApplicationScore,
  ApplicationStatus,
  Position,
  PositionSlug,
  Question,
  QuestionOption,
  QuestionType,
  SystemSetting,
  DiscordNotification,
} from '../types'
import type { SettingsMap } from './api-public'

export const NOT_CONFIGURED_MESSAGE =
  'Yönetim paneli yapılandırılmadı. Lütfen sistem yöneticisine başvurun.'

export const CSRF_COOKIE_NAME = 'lsc_csrf'

export class ApiError extends Error {
  code?: string
  status?: number

  constructor(message: string, code?: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    Object.setPrototypeOf(this, ApiError.prototype)
  }
}

/** Tarayıcıdaki okunabilir CSRF çerezini döndürür (yoksa boş metin). */
export function getCsrfCookie(): string {
  if (typeof document === 'undefined' || !document.cookie) return ''
  for (const part of document.cookie.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    if (part.slice(0, separator).trim() !== CSRF_COOKIE_NAME) continue
    const value = part.slice(separator + 1).trim()
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }
  return ''
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | boolean | null | undefined>
  /** Giriş sayfasındaki 401 yanıtını yönlendirme yapmadan göstermek için. */
  skipUnauthorizedRedirect?: boolean
}

interface ConfiguredClient {
  anonKey: string
  functionsUrl: (path: string) => string
}

async function getConfiguredClient(): Promise<ConfiguredClient> {
  const module = await import('./supabase')
  const config = module.getSupabaseConfig()
  if (!config.isConfigured) {
    throw new ApiError(NOT_CONFIGURED_MESSAGE, 'NOT_CONFIGURED', 503)
  }
  return { anonKey: config.anonKey, functionsUrl: module.FUNCTIONS_URL }
}

function redirectToLogin(): void {
  if (typeof window === 'undefined') return
  const path = window.location.pathname
  if (path.startsWith('/admin/login') || path.startsWith('/admin/setup')) return
  window.location.assign('/admin/login')
}

async function readErrorPayload(response: Response): Promise<{ message: string; code?: string }> {
  let payload: any
  try {
    payload = await response.json()
  } catch {
    return { message: 'İşlem tamamlanamadı. Lütfen tekrar deneyin.' }
  }
  const detail = payload?.error ?? payload
  const rawMessage =
    typeof detail === 'string'
      ? detail
      : detail?.message ?? detail?.error_description ?? payload?.message
  const rawCode = typeof detail === 'object' && detail !== null ? detail?.code ?? payload?.code : payload?.code
  return {
    message:
      typeof rawMessage === 'string' && rawMessage.trim()
        ? rawMessage.trim()
        : 'İşlem tamamlanamadı. Lütfen tekrar deneyin.',
    code: rawCode === undefined || rawCode === null ? undefined : String(rawCode),
  }
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const config = await getConfiguredClient()
  const url = new URL(config.functionsUrl(`/${endpoint}`))
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined || value === null || value === '') continue
    url.searchParams.set(key, String(value))
  }

  let response: Response
  try {
    response = await fetch(url.toString(), {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
        'X-CSRF-Token': getCsrfCookie(),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    })
  } catch {
    throw new ApiError('Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.', 'NETWORK')
  }

  if (!response.ok) {
    const { message, code } = await readErrorPayload(response)
    if (response.status === 401 && !options.skipUnauthorizedRedirect) redirectToLogin()
    throw new ApiError(message, code, response.status)
  }

  try {
    return (await response.json()) as T
  } catch {
    throw new ApiError('Sunucudan beklenen yanıt alınamadı.', 'BAD_RESPONSE', response.status)
  }
}

// ---------------------------------------------------------------------------
// Kimlik doğrulama
// ---------------------------------------------------------------------------

export interface AdminAuthResponse {
  ok: boolean
  admin?: { username: string }
  csrf_token?: string | null
}

export interface LoginResponse extends AdminAuthResponse {
  csrf_token?: string
}

export interface SetupStatusResponse {
  exists: boolean
  has_admin?: boolean
  setup_required?: boolean
}

export async function verifyAdmin(): Promise<AdminAuthResponse> {
  return request<AdminAuthResponse>('admin-auth', {
    method: 'POST',
    body: { action: 'verify' },
    skipUnauthorizedRedirect: true,
  })
}

export async function loginAdmin(username: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>('admin-auth', {
    method: 'POST',
    body: { action: 'login', username, password },
    skipUnauthorizedRedirect: true,
  })
}

export async function logoutAdmin(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('admin-auth', { method: 'POST', body: { action: 'logout' } })
}

export async function getSetupStatus(): Promise<SetupStatusResponse> {
  const result = await request<{
    ok: boolean
    exists?: boolean
    has_admin?: boolean
    setup_required?: boolean
  }>('admin-auth', {
    method: 'POST',
    body: { action: 'setup-status' },
    skipUnauthorizedRedirect: true,
  })
  const hasAdmin = result.exists ?? result.has_admin ?? (result.setup_required === false)
  return { ...result, exists: Boolean(hasAdmin) }
}

// ---------------------------------------------------------------------------
// Sorular
// ---------------------------------------------------------------------------

export interface QuestionPayload {
  question_text: string
  type: QuestionType
  category_id: string | null
  position_slug: PositionSlug | 'all' | null
  is_required: boolean
  is_active: boolean
  help_text: string | null
  min_length: number | null
  max_length: number | null
  sort_order: number
  options?: Array<Pick<QuestionOption, 'label' | 'value' | 'sort_order' | 'is_active'>>
}

export type QuestionPatch = Partial<QuestionPayload> & { id: string }

export async function listQuestions(): Promise<Question[]> {
  const result = await request<{ ok: boolean; questions: Question[] }>('admin-questions')
  return result.questions ?? []
}

export async function createQuestion(payload: QuestionPayload): Promise<Question> {
  const result = await request<{ ok: boolean; question: Question }>('admin-questions', {
    method: 'POST',
    body: payload,
  })
  return result.question
}

export async function updateQuestion(payload: QuestionPatch): Promise<Question> {
  const result = await request<{ ok: boolean; question: Question }>('admin-questions', {
    method: 'PATCH',
    body: payload,
  })
  return result.question
}

export async function deleteQuestion(id: string): Promise<void> {
  await request<{ ok: boolean }>('admin-questions', { method: 'DELETE', body: { id } })
}

export async function reorderQuestions(ids: string[]): Promise<void> {
  await request<{ ok: boolean }>('admin-questions', {
    method: 'POST',
    body: { action: 'reorder', ids },
  })
}

// ---------------------------------------------------------------------------
// Pozisyonlar
// ---------------------------------------------------------------------------

export interface PositionPatch {
  id: string
  name?: string
  description?: string | null
  is_active?: boolean
  is_open?: boolean
  sort_order?: number
}

export async function listPositions(): Promise<Position[]> {
  const result = await request<{ ok: boolean; positions: Position[] }>('admin-positions')
  return result.positions ?? []
}

export async function updatePosition(payload: PositionPatch): Promise<Position> {
  const result = await request<{ ok: boolean; position: Position }>('admin-positions', {
    method: 'PATCH',
    body: payload,
  })
  return result.position
}

// ---------------------------------------------------------------------------
// Başvurular
// ---------------------------------------------------------------------------

export interface ApplicationListParams {
  status?: ApplicationStatus | 'all'
  position_slug?: PositionSlug | 'all'
  search?: string
  limit?: number
  offset?: number
}

export interface ApplicationListResponse {
  applications: Application[]
  total: number
  limit: number
  offset: number
}

export interface ApplicationDetailResponse {
  application: Application
  answers: ApplicationAnswer[]
  scores: ApplicationScore[]
  notes: ApplicationNote[]
  history: ApplicationHistory[]
}

export async function listApplications(
  params: ApplicationListParams = {},
): Promise<ApplicationListResponse> {
  const result = await request<{
    ok: boolean
    applications: Application[]
    total: number
    limit?: number
    offset?: number
  }>('admin-applications', { query: { ...params } })
  return {
    applications: result.applications ?? [],
    total: Number(result.total ?? result.applications?.length ?? 0),
    limit: Number(result.limit ?? params.limit ?? 50),
    offset: Number(result.offset ?? params.offset ?? 0),
  }
}

export async function getApplication(id: string): Promise<ApplicationDetailResponse> {
  return request<ApplicationDetailResponse>('admin-applications', { query: { action: 'get', id } })
}

export async function updateApplicationStatus(
  id: string,
  status: ApplicationStatus,
  note?: string,
): Promise<{ ok: boolean; application: Application; notification_status?: string }> {
  return request('admin-applications', {
    method: 'PATCH',
    body: { id, status, ...(note?.trim() ? { note: note.trim() } : {}) },
  })
}

// ---------------------------------------------------------------------------
// Puanlar ve özel notlar
// ---------------------------------------------------------------------------

export interface ScoreEntry {
  criterion_key: string
  points: number
}

export type ScorePayload = Record<string, number> | ScoreEntry[]

function normalizeScores(scores: ScorePayload): Record<string, number> {
  if (Array.isArray(scores)) {
    const record: Record<string, number> = {}
    for (const entry of scores) record[entry.criterion_key] = entry.points
    return record
  }
  return scores
}

export async function saveScores(
  applicationId: string,
  scores: ScorePayload,
): Promise<{ ok: boolean; total_score: number }> {
  return request('admin-scores', {
    method: 'POST',
    body: { application_id: applicationId, scores: normalizeScores(scores) },
  })
}

export async function addNote(
  applicationId: string,
  note: string,
): Promise<{ ok: boolean; note: ApplicationNote }> {
  return request('admin-scores', {
    method: 'POST',
    body: { action: 'note', application_id: applicationId, note },
  })
}

// ---------------------------------------------------------------------------
// Ayarlar ve Discord bildirimleri
// ---------------------------------------------------------------------------

export interface SettingsResponse {
  ok: boolean
  settings: SettingsMap
  rows?: SystemSetting[]
}

export async function getSettings(): Promise<SettingsMap> {
  const result = await request<SettingsResponse>('admin-settings')
  return result.settings ?? {}
}

export async function updateSettings(settings: Record<string, string | number | boolean | null>): Promise<SettingsMap> {
  const result = await request<SettingsResponse>('admin-settings', {
    method: 'PATCH',
    body: { settings },
  })
  return result.settings ?? {}
}

export async function listNotifications(applicationId?: string): Promise<DiscordNotification[]> {
  const result = await request<{ ok: boolean; notifications: DiscordNotification[] }>('discord-notify', {
    query: { action: 'list', application_id: applicationId },
  })
  return result.notifications ?? []
}

export async function sendNotification(applicationId: string): Promise<{ ok: boolean; notification_status: string; error?: string }> {
  return request('discord-notify', { method: 'POST', body: { action: 'send', application_id: applicationId } })
}

export async function retryNotification(notificationId: string): Promise<{ ok: boolean; notification_status: string; error?: string }> {
  return request('discord-notify', { method: 'POST', body: { action: 'retry', notification_id: notificationId } })
}
