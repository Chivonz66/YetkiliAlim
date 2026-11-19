// Başvuru alma: oran sınırı, honeypot, soru anlık görüntüsü ve tek kullanımlık sorgu belirteci.
import { preflight, withCors } from '../_shared/cors.ts'
import { getAdminClient } from '../_shared/db.ts'
import {
  bytesToHex,
  createTrackingNo,
  dailyActivityToHours,
  env,
  hashIp,
  isHumanSubmission,
  sha256Hex,
} from '../_shared/pure.ts'
import { defaultMessage, error, json } from '../_shared/responses.ts'
import { readJson, validate } from '../_shared/validation.ts'

type AnswerValue = string | number | boolean | string[]
type ApplicationData = {
  position_slug: 'rehber' | 'aac'
  applicant_minecraft_username: string
  applicant_discord_username: string
  age: number
  daily_hours: number
  minecraft_experience?: string | null
  staff_experience?: string | null
  self_introduction?: string | null
  answers: Record<string, AnswerValue> | Array<{ question_id: string; value: AnswerValue }>
  website?: string | null
  elapsed_ms: number
}

type Question = {
  id: string
  question_text: string
  question_type: string
  is_required: boolean
  min_length?: number | null
  max_length?: number | null
  min_value?: number | null
  max_value?: number | null
  position_slug?: string | null
}

type Option = {
  question_id: string
  label: string
  value: string
  sort_order?: number
  is_active?: boolean
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

async function readSetting(client: any, key: string, fallback: string): Promise<string> {
  try {
    const { data, error: dbError } = await client
      .from('app_settings')
      .select('value')
      .eq('key', key)
      .maybeSingle()
    if (dbError || !data) return fallback
    const value = data.value
    return value === null || value === undefined || value === '' ? fallback : String(value)
  } catch {
    return fallback
  }
}

/** rate_limits tablosunda saatlik pencereyi (key, window_start, hit_count) günceller. */
async function enforceRateLimit(client: any, key: string, limit: number): Promise<boolean> {
  const windowStart = new Date()
  windowStart.setUTCMinutes(0, 0, 0)
  const at = windowStart.toISOString()

  const existing = await client
    .from('rate_limits')
    .select('hit_count, window_start')
    .eq('key', key)
    .eq('window_start', at)
    .maybeSingle()
  if (existing.error) return false

  const count = Number(existing.data?.hit_count ?? 0)
  if (existing.data && Number.isFinite(count) && count >= limit) return false
  if (existing.data) {
    const updated = await client
      .from('rate_limits')
      .update({ hit_count: count + 1 })
      .eq('key', key)
      .eq('window_start', at)
    return !updated.error
  }
  const upsert = await client
    .from('rate_limits')
    .upsert({ key, window_start: at, hit_count: 1 }, { onConflict: 'key,window_start' })
  return !upsert.error
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, 4000) : null
}

/**
 * Genel formun iç içe `applicant` gövdesini doğrulama şemasının beklediği
 * düz, şema adlarıyla eşleşen yapıya çevirir. Eski düz gövde de kabul edilir.
 */
function normalizeSubmission(raw: Record<string, unknown>): Record<string, unknown> {
  const applicant =
    raw.applicant && typeof raw.applicant === 'object'
      ? (raw.applicant as Record<string, unknown>)
      : {}
  const minecraft = String(
    applicant.minecraft_username ?? raw.applicant_minecraft_username ?? raw.applicant_name ?? '',
  ).trim()
  const discordRaw = String(
    applicant.discord_username ?? raw.applicant_discord_username ?? raw.discord_username ?? '',
  ).trim()
  // Şema applicant_discord_username alanını NOT NULL ve en az 3 karakterli zorunlu kılar.
  const discord = /^[A-Za-z0-9_.]{3,32}$/.test(discordRaw) ? discordRaw : minecraft
  const ageRaw = applicant.age ?? raw.age
  const hoursRaw =
    applicant.daily_hours ?? raw.daily_hours ?? applicant.hours_per_week ?? raw.hours_per_week
  const hours =
    hoursRaw === undefined || hoursRaw === null
      ? dailyActivityToHours(applicant.daily_activity ?? raw.daily_activity)
      : Number(hoursRaw)
  const age = typeof ageRaw === 'string' ? Number(ageRaw) : ageRaw
  return {
    position_slug: raw.position_slug,
    applicant_minecraft_username: minecraft,
    applicant_discord_username: discord,
    age: typeof age === 'number' && Number.isFinite(age) ? age : -1,
    daily_hours: typeof hours === 'number' && Number.isFinite(hours) ? hours : -1,
    minecraft_experience: textOrNull(applicant.minecraft_experience ?? raw.minecraft_experience),
    staff_experience: textOrNull(applicant.staff_experience ?? raw.staff_experience),
    self_introduction: textOrNull(applicant.self_introduction ?? raw.self_introduction),
    answers: raw.answers ?? {},
    website: raw.website ?? '',
    elapsed_ms: typeof raw.elapsed_ms === 'string' ? Number(raw.elapsed_ms) : raw.elapsed_ms,
  }
}

function normalizeAnswers(
  answers: ApplicationData['answers'],
): Record<string, AnswerValue> {
  if (Array.isArray(answers)) {
    const result: Record<string, AnswerValue> = {}
    for (const entry of answers) result[entry.question_id] = entry.value
    return result
  }
  return answers
}

function isEmptyAnswer(value: AnswerValue | undefined): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
}

function answerValid(question: Question, answer: AnswerValue | undefined, options: Option[]): boolean {
  if (isEmptyAnswer(answer)) return !question.is_required
  const values = options.map((option) => option.value)
  switch (question.question_type) {
    case 'short_text':
    case 'long_text': {
      if (typeof answer !== 'string') return false
      if (question.min_length != null && answer.length < Number(question.min_length)) return false
      if (question.max_length != null && answer.length > Number(question.max_length)) return false
      return true
    }
    case 'number': {
      const numeric = typeof answer === 'number' ? answer : Number(answer)
      if (!Number.isFinite(numeric)) return false
      if (question.min_value != null && numeric < Number(question.min_value)) return false
      if (question.max_value != null && numeric > Number(question.max_value)) return false
      return true
    }
    case 'single_choice':
      return typeof answer === 'string' && (values.length === 0 || values.includes(answer))
    case 'multiple_choice':
      return (
        Array.isArray(answer) &&
        answer.every((item) => typeof item === 'string' && (values.length === 0 || values.includes(item)))
      )
    case 'yes_no':
      return (
        typeof answer === 'boolean' ||
        (typeof answer === 'string' && ['evet', 'hayır', 'true', 'false'].includes(answer.toLowerCase()))
      )
    case 'checkbox':
      return answer === true || answer === 'true' || answer === 'on'
    default:
      return false
  }
}

async function run(req: Request): Promise<Response> {
  if (req.method !== 'POST') return error(defaultMessage(405), 405, 'method_not_allowed')

  const parsed = await readJson(req)
  if (!parsed.ok) return error(parsed.error, 400, 'invalid_body')
  const normalized = normalizeSubmission(parsed.data as Record<string, unknown>)
  const checked = await validate<ApplicationData>('application', normalized)
  if (!checked.ok) return error(checked.error, 400, 'validation')
  const data = checked.data

  const db = await getAdminClient()
  if (!db.ok) return error(db.error, 503, 'configuration')
  const client = db.client

  // Honeypot ve yapay hızlı gönderimler.
  if (!isHumanSubmission(data.website, data.elapsed_ms)) {
    if (String(data.website ?? '').trim() !== '') {
      return error('Başvuru gönderilemedi.', 400, 'honeypot')
    }
    return error('Başvuru çok hızlı gönderildi. Lütfen formu dikkatlice doldurun.', 429, 'too_fast')
  }

  const closedMessage = await readSetting(client, 'closed_message', 'Başvurular şu anda kapalı.')
  const applicationsOpen = await readSetting(client, 'applications_open', 'true')
  if (!['1', 'true', 'yes', 'on'].includes(applicationsOpen.toLowerCase())) {
    return error(closedMessage, 403, 'applications_closed')
  }

  const rateLimitRaw = await readSetting(client, 'rate_limit_per_ip_per_hour', '5')
  const rateLimit = Math.max(1, Number.parseInt(rateLimitRaw, 10) || 5)
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = forwarded || req.headers.get('x-real-ip')?.trim() || 'unknown'
  const ipSalt = env('RATE_LIMIT_SALT') ?? ''
  const ipKey = `ip:${hashIp(ip, ipSalt)}`
  const allowed = await enforceRateLimit(client, ipKey, rateLimit)
  if (!allowed) {
    return error('Çok fazla başvuru gönderdiniz. Lütfen bir saat sonra tekrar deneyin.', 429, 'rate_limit')
  }

  // Sorular ve seçenekler yalnızca veritabanından okunur; istemci metni asla güvenilmez.
  const questionsResult = await client
    .from('questions')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
  if (questionsResult.error) return error(defaultMessage(500), 500, 'database')
  const optionsResult = await client
    .from('question_options')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
  if (optionsResult.error) return error(defaultMessage(500), 500, 'database')

  const optionsByQuestion = new Map<string, Option[]>()
  for (const option of (optionsResult.data ?? []) as Option[]) {
    const list = optionsByQuestion.get(option.question_id) ?? []
    list.push(option)
    optionsByQuestion.set(option.question_id, list)
  }
  const questions = ((questionsResult.data ?? []) as Question[]).filter((question) =>
    [data.position_slug, 'all', null, undefined].includes(question.position_slug as any),
  )
  const submitted = normalizeAnswers(data.answers)
  for (const question of questions) {
    const options = optionsByQuestion.get(question.id) ?? []
    if (!answerValid(question, submitted[question.id], options)) {
      return error(`“${question.question_text}” sorusunun cevabı geçersiz.`, 400, 'invalid_answer')
    }
  }

  const trackingNo = createTrackingNo(new Date().getUTCFullYear(), randomBytes(12))
  const queryToken = bytesToHex(randomBytes(32))
  const tokenHash = sha256Hex(queryToken)
  const submittedAt = new Date().toISOString()
  // Yalnızca 0001 şemasında bulunan sütunlar yazılır; ham sorgu anahtarı saklanmaz.
  const applicationRow = {
    tracking_no: trackingNo,
    query_token_hash: tokenHash,
    position_slug: data.position_slug,
    status: 'pending',
    applicant_minecraft_username: data.applicant_minecraft_username,
    applicant_discord_username: data.applicant_discord_username,
    discord_connected: false,
    age: data.age,
    daily_hours: data.daily_hours,
    minecraft_experience: data.minecraft_experience ?? null,
    staff_experience: data.staff_experience ?? null,
    self_introduction: data.self_introduction ?? null,
    submitted_at: submittedAt,
    source_ip_hash: hashIp(ip, ipSalt),
  }
  const inserted = await client
    .from('applications')
    .insert(applicationRow)
    .select('id, tracking_no')
    .single()
  if (inserted.error || !inserted.data) return error(defaultMessage(500), 500, 'database')

  const applicationId = inserted.data.id as string
  const answerRows = questions
    .filter((question) => !isEmptyAnswer(submitted[question.id]))
    .map((question) => {
      const options = optionsByQuestion.get(question.id) ?? []
      return {
        application_id: applicationId,
        question_id: question.id,
        question_text: question.question_text,
        question_type: question.question_type,
        position_slug: question.position_slug ?? null,
        options_snapshot: options.map((option) => ({
          label: option.label,
          value: option.value,
          sort_order: option.sort_order ?? 0,
        })),
        value: submitted[question.id] ?? null,
      }
    })
  if (answerRows.length > 0) {
    const answersInsert = await client.from('application_answers').insert(answerRows)
    if (answersInsert.error) return error(defaultMessage(500), 500, 'database')
  }

  return json(
    { ok: true, tracking_no: trackingNo, query_token: queryToken },
    200,
    { 'Cache-Control': 'no-store' },
  )
}

;(globalThis as any).Deno.serve(async (req: Request): Promise<Response> => {
  const options = preflight(req)
  if (options) return options
  try {
    return withCors(req, await run(req))
  } catch {
    return withCors(req, error(defaultMessage(500), 500, 'internal'))
  }
})
