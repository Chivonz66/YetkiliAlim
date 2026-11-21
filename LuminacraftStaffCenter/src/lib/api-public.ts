/**
 * Genel (public) sayfaların Supabase / Edge Function erişim katmanı.
 *
 * Supabase modülü bilerek yalnızca fonksiyonların içinde dinamik olarak
 * içe aktarılır: bu dosya saf yardımcılar için içe aktarıldığında hiçbir
 * istemci oluşturulmaz ve ağ isteği yapılmaz.
 */
import { QUESTION_CATEGORIES, QUESTION_TYPES } from './constants'
import type { Position, Question, QuestionOption, QuestionType } from '../types'

export const NOT_CONFIGURED_MESSAGE =
  'Sistem yapılandırılmadı. Lütfen daha sonra tekrar deneyin.'
export const DEFAULT_CLOSED_MESSAGE =
  'Başvurular şu anda kapalı. Yeni duyurular için bizi takip edin.'

const FUNCTIONS_PATH = '/functions/v1'

/** Hata durumunda sayfaların güvenle gösterebileceği tipli sonuç. */
export interface PublicResult<T> {
  ok: boolean
  data?: T
  error?: string
  code?: string
}

/** Promise.allSettled gibi akışlarda sebep nesnesini daraltmak için kullanılır. */
export interface PublicApiErrorLike {
  code?: string
  message?: string
}

export class PublicApiError extends Error {
  code?: string
  status?: number

  constructor(message: string, code?: string, status?: number) {
    super(message)
    this.name = 'PublicApiError'
    this.code = code
    this.status = status
  }
}

// ---------------------------------------------------------------------------
// Ayar yardımcıları (saf)
// ---------------------------------------------------------------------------

export type SettingsMap = Record<string, any>

function decodeSettingValue(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (/^(true|false|null|-?\d+(?:\.\d+)?|"[^"]*")$/i.test(trimmed)) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed
    }
  }
  return trimmed
}

export function getSettingValue(settings: SettingsMap | null | undefined, key: string): unknown {
  if (!settings || typeof settings !== 'object') return undefined
  return decodeSettingValue(settings[key])
}

/** Ayar kapalıysa false, açıksa true, ayar yoksa undefined döner. */
export function getSettingFlag(
  settings: SettingsMap | null | undefined,
  key: string,
): boolean | undefined {
  const value = getSettingValue(settings, key)
  if (value === false || value === 0) return false
  if (value === true || value === 1) return true
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['false', '0', 'no', 'hayir', 'hayır', 'kapali', 'kapalı', 'off'].includes(normalized)) {
      return false
    }
    if (['true', '1', 'yes', 'evet', 'acik', 'açık', 'on'].includes(normalized)) {
      return true
    }
  }
  return undefined
}

export function isSettingDisabled(settings: SettingsMap | null | undefined, key: string): boolean {
  return getSettingFlag(settings, key) === false
}

export function getClosedMessage(
  settings: SettingsMap | null | undefined,
  fallback: string = DEFAULT_CLOSED_MESSAGE,
): string {
  for (const key of ['closed_message', 'applications_closed_message', 'basvuru_kapali_mesaji']) {
    const value = getSettingValue(settings, key)
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return fallback
}

export function areApplicationsOpen(settings: SettingsMap | null | undefined): boolean {
  return !isSettingDisabled(settings, 'applications_open')
}

/** Pozisyon açıklığının tek kaynağı: `${slug}_applications_open`. */
export function positionOpenSettingKey(slug: string): string {
  return `${slug}_applications_open`
}

export function isPositionOpen(
  settings: SettingsMap | null | undefined,
  slug: string,
  position?: Partial<Position> & { is_open?: unknown } | null,
): boolean {
  if (position && (position.is_active === false || position.is_open === false)) return false
  if (!areApplicationsOpen(settings)) return false
  return !isSettingDisabled(settings, positionOpenSettingKey(slug))
}

// ---------------------------------------------------------------------------
// Başvuru gönderimi yardımcıları (saf)
// ---------------------------------------------------------------------------

export interface AnswerEntry {
  question_id: string
  value: unknown
}

export interface ApplicantPayload {
  [key: string]: unknown
}

export interface SubmitApplicationPayload {
  position_slug: string
  applicant: ApplicantPayload
  answers: Record<string, unknown> | AnswerEntry[]
  website?: string
  elapsed_ms?: number
}

export interface ApplicationPayloadWire {
  position_slug: string
  applicant: ApplicantPayload
  answers: AnswerEntry[]
  website: string
  elapsed_ms: number
}

function isEmptyAnswer(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

export function isHoneypotFilled(website: unknown): boolean {
  if (website === null || website === undefined) return false
  return String(website).trim().length > 0
}

export function computeElapsedMs(startedAt: number, now: number = Date.now()): number {
  if (!Number.isFinite(startedAt)) return 0
  return Math.max(0, Math.min(Math.round(now - startedAt), 3_600_000))
}

/** İstemci yalnızca soru kimliği ve cevabı gönderir; soru metni/tipi/seçenekleri asla gönderilmez. */
export function normalizeAnswers(
  answers: Record<string, unknown> | AnswerEntry[] | null | undefined,
): AnswerEntry[] {
  const entries: AnswerEntry[] = Array.isArray(answers)
    ? answers.map((item) => ({
        question_id: String(item?.question_id ?? ''),
        value: item?.value,
      }))
    : Object.entries(answers ?? {}).map(([question_id, value]) => ({ question_id, value }))

  return entries
    .filter((entry) => entry.question_id.trim().length > 0 && !isEmptyAnswer(entry.value))
    .map((entry) => ({ question_id: entry.question_id, value: entry.value }))
}

export function buildApplicationPayload(
  payload: SubmitApplicationPayload,
): ApplicationPayloadWire {
  return {
    position_slug: String(payload.position_slug ?? '').trim(),
    applicant: payload.applicant ?? {},
    answers: normalizeAnswers(payload.answers),
    website: String(payload.website ?? ''),
    // `elapsed_ms` formun açıldığı andan itibaren geçen süredir (dahili sayaç).
    elapsed_ms: payload.elapsed_ms === undefined
      ? 0
      : Math.max(0, Math.min(Math.round(payload.elapsed_ms), 3_600_000)),
  }
}

// ---------------------------------------------------------------------------
// Soru yardımcıları (saf)
// ---------------------------------------------------------------------------

export type PublicQuestion = Question & {
  category_name?: string
  question_options?: QuestionOption[]
}

interface RawOption {
  id?: unknown
  question_id?: unknown
  label?: unknown
  value?: unknown
  sort_order?: unknown
  is_active?: unknown
  text?: unknown
  option_label?: unknown
  option_value?: unknown
  option_sort_order?: unknown
  option_is_active?: unknown
  options_snapshot?: unknown
}

function normalizeOption(input: unknown): QuestionOption | null {
  if (typeof input === 'string') {
    const text = input.trim()
    return text ? { label: text, value: text, sort_order: 0 } : null
  }
  if (!input || typeof input !== 'object') return null
  const raw = input as RawOption
  const label = String(
    raw.label ?? raw.option_label ?? raw.text ?? raw.value ?? raw.option_value ?? '',
  ).trim()
  const value = String(raw.value ?? raw.option_value ?? label).trim()
  if (!label || !value) return null
  const order = Number(raw.sort_order ?? raw.option_sort_order ?? 0)
  return {
    id: raw.id ? String(raw.id) : undefined,
    question_id: raw.question_id ? String(raw.question_id) : undefined,
    label,
    value,
    sort_order: Number.isFinite(order) ? order : 0,
    is_active: raw.is_active !== false,
  }
}

/** RPC yanıtı iç içe `question_options` veya düz `options`/`option_*` biçiminde gelebilir. */
export function getQuestionOptions(question: Question | PublicQuestion | null | undefined): QuestionOption[] {
  if (!question) return []
  const raw = question as PublicQuestion & RawOption
  const collected: QuestionOption[] = []

  for (const list of [raw.question_options, raw.options, raw.options_snapshot]) {
    if (!Array.isArray(list)) continue
    for (const item of list) {
      const option = normalizeOption(item)
      if (option) collected.push(option)
    }
  }

  const flat = normalizeOption({
    label: raw.option_label ?? raw.label,
    value: raw.option_value ?? raw.value,
    sort_order: raw.option_sort_order,
    is_active: raw.option_is_active,
  })
  // Soru metninin kendisini seçenek sanmayı önle.
  if (flat && flat.value !== raw.question_text) collected.push(flat)

  const seen = new Set<string>()
  return collected
    .filter((option) => option.is_active !== false && !seen.has(option.value) && Boolean(seen.add(option.value)))
    .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label, 'tr'))
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function nullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text || null
}

export function mapPublicQuestion(raw: unknown): PublicQuestion | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, any>
  if (!row.id) return null
  // RPC `get_public_questions` DB sütun adlarını döndürür (`question_type`),
  // yönetim API'si ise istemci sözleşmesini (`type`) kullanır. İkisini de kabul et.
  const rawType = row.type ?? row.question_type
  const type: QuestionType = QUESTION_TYPES.some((item) => item.value === rawType)
    ? (rawType as QuestionType)
    : 'short_text'
  const category = row.question_categories ?? row.category ?? null
  const categoryId = row.category_id ?? row.category_slug ?? null
  const positionSlug = ['rehber', 'aac', 'all'].includes(String(row.position_slug))
    ? (row.position_slug as Question['position_slug'])
    : null

  return {
    id: String(row.id),
    category_id: categoryId ? String(categoryId) : null,
    position_slug: positionSlug,
    type,
    question_text: String(row.question_text ?? row.question ?? ''),
    help_text: nullableText(row.help_text),
    is_required: Boolean(row.is_required),
    is_active: row.is_active !== false,
    min_length: nullableNumber(row.min_length),
    max_length: nullableNumber(row.max_length),
    min_value: nullableNumber(row.min_value),
    max_value: nullableNumber(row.max_value),
    sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : 0,
    options: getQuestionOptions(row as Question),
    created_at: nullableText(row.created_at) ?? undefined,
    updated_at: nullableText(row.updated_at) ?? undefined,
    category_name: nullableText(category?.name) ?? nullableText(row.category_name) ?? undefined,
    question_options: Array.isArray(row.question_options) ? row.question_options : undefined,
  }
}

const CATEGORY_ORDER = QUESTION_CATEGORIES.map((category) => category.slug)

/** Kategori kimliği UUID olabileceği için slug/eşleşen ad üzerinden çözümlenir. */
export function getQuestionCategoryLabel(question: PublicQuestion | Question): string {
  const extended = question as PublicQuestion
  if (extended.category_name) return extended.category_name
  const row = extended as unknown as { category?: { name?: string }; question_categories?: { name?: string } }
  if (row.category?.name) return row.category.name
  if (row.question_categories?.name) return row.question_categories.name
  const key = String(question.category_id ?? '')
  return QUESTION_CATEGORIES.find((category) => category.slug === key || category.value === key)?.name
    ?? 'Diğer sorular'
}

export interface QuestionGroup {
  id: string
  name: string
  description?: string
  questions: PublicQuestion[]
}

export function groupQuestions(questions: PublicQuestion[]): QuestionGroup[] {
  const buckets = new Map<string, PublicQuestion[]>()
  for (const question of questions) {
    const key = String(question.category_id ?? 'general')
    const list = buckets.get(key) ?? []
    list.push(question)
    buckets.set(key, list)
  }

  return Array.from(buckets.entries())
    .map(([id, groupQuestionsList]) => {
      const first = groupQuestionsList[0]
      const meta = QUESTION_CATEGORIES.find((category) => category.slug === id || category.value === id)
      return {
        id,
        name: getQuestionCategoryLabel(first),
        description: meta?.description,
        questions: [...groupQuestionsList].sort((a, b) => a.sort_order - b.sort_order),
      }
    })
    .sort((a, b) => {
      const aIndex = CATEGORY_ORDER.indexOf(a.id)
      const bIndex = CATEGORY_ORDER.indexOf(b.id)
      return (aIndex < 0 ? 999 : aIndex) - (bIndex < 0 ? 999 : bIndex)
    })
}

// ---------------------------------------------------------------------------
// Supabase / Edge Function çağrıları
// ---------------------------------------------------------------------------

async function getConfiguredClient() {
  const module = await import('./supabase')
  if (!module.getSupabaseConfig().isConfigured) {
    throw new PublicApiError(NOT_CONFIGURED_MESSAGE, 'NOT_CONFIGURED')
  }
  return module
}

async function readErrorPayload(response: Response): Promise<{ message: string; code?: string }> {
  let payload: any
  try {
    payload = await response.json()
  } catch {
    return { message: 'Lütfen daha sonra tekrar deneyin.' }
  }
  const detail = payload?.error ?? payload
  const rawMessage =
    typeof detail === 'string' ? detail : detail?.message ?? detail?.error_description ?? payload?.message
  const rawCode = typeof detail === 'object' ? detail?.code ?? payload?.code : payload?.code
  return {
    message: typeof rawMessage === 'string' && rawMessage.trim()
      ? rawMessage.trim()
      : 'Lütfen daha sonra tekrar deneyin.',
    code: rawCode === undefined || rawCode === null ? undefined : String(rawCode),
  }
}

async function postJson<T>(path: string, body: unknown, errorPrefix: string): Promise<T> {
  const module = await getConfiguredClient()
  const { anonKey } = module.getSupabaseConfig()
  let response: Response
  try {
    response = await fetch(module.FUNCTIONS_URL(path), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify(body),
    })
  } catch {
    throw new PublicApiError('Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.', 'NETWORK')
  }

  if (!response.ok) {
    const { message, code } = await readErrorPayload(response)
    throw new PublicApiError(`${errorPrefix} ${message}`, code, response.status)
  }

  try {
    return (await response.json()) as T
  } catch {
    throw new PublicApiError('Sunucudan beklenmeyen bir yanıt alındı.', 'BAD_RESPONSE', response.status)
  }
}

export async function getPositions(): Promise<Position[]> {
  const { supabase } = await getConfiguredClient()
  const { data, error } = await supabase
    .from('positions')
    .select('*')
    .eq('is_active', true)
    .order('sort_order')

  if (error) throw new PublicApiError(`Pozisyonlar yüklenemedi. ${error.message}`, error.code)
  return (data ?? []) as Position[]
}

export async function getQuestions(positionSlug: string): Promise<PublicQuestion[]> {
  const { supabase } = await getConfiguredClient()
  const { data, error } = await supabase.rpc('get_public_questions', {
    p_position_slug: positionSlug,
  })

  if (error) throw new PublicApiError(`Sorular yüklenemedi. ${error.message}`, error.code)
  const rows: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray((data as any)?.questions)
      ? (data as any).questions
      : []
  return rows.map(mapPublicQuestion).filter((question): question is PublicQuestion => Boolean(question))
}

export async function getSettings(): Promise<SettingsMap> {
  const { supabase } = await getConfiguredClient()
  const { data, error } = await supabase.from('app_settings').select('key,value')

  if (error) throw new PublicApiError(`Ayarlar yüklenemedi. ${error.message}`, error.code)
  const settings: SettingsMap = {}
  for (const row of (data ?? []) as Array<{ key?: string; value?: unknown }>) {
    if (row?.key) settings[String(row.key)] = row.value
  }
  return settings
}

export interface SubmissionResult {
  tracking_no: string
  query_token: string
}

export async function submitApplication(payload: SubmitApplicationPayload): Promise<SubmissionResult> {
  const body = buildApplicationPayload(payload)
  if (!body.position_slug) {
    throw new PublicApiError('Geçerli bir pozisyon seçilmedi.', 'VALIDATION')
  }
  const result = await postJson<SubmissionResult>(
    '/submit-application',
    body,
    'Başvurunuz gönderilemedi.',
  )
  if (!result?.tracking_no || !result?.query_token) {
    throw new PublicApiError('Sunucudan beklenen başvuru bilgileri alınamadı.', 'BAD_RESPONSE')
  }
  return { tracking_no: String(result.tracking_no), query_token: String(result.query_token) }
}

export interface StatusLookupResponse {
  tracking_no?: string
  position_slug?: string
  status?: string
  submitted_at?: string | null
  reviewed_at?: string | null
  decision_date?: string | null
}

export async function lookupStatus(trackingNo: string, queryToken: string): Promise<StatusLookupResponse> {
  const tracking_no = String(trackingNo ?? '').trim()
  const query_token = String(queryToken ?? '').trim()
  if (!tracking_no || !query_token) {
    throw new PublicApiError('Başvuru numarası ve sorgu kodu zorunludur.', 'VALIDATION')
  }
  return postJson<StatusLookupResponse>(
    '/public-status',
    { tracking_no, query_token },
    'Başvuru sorgulanamadı.',
  )
}
