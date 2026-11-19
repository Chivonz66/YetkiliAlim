// Başvuru alma: oran sınırı, honeypot, soru anlık görüntüsü ve tek kullanımlık sorgu belirteci.
import { preflight, withCors } from '../_shared/cors.ts'
import { getAdminClient } from '../_shared/db.ts'
import {
  bytesToHex,
  createTrackingNo,
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
  applicant_name: string
  applicant_email: string
  discord_username: string
  age: number
  hours_per_week: number
  answers: Record<string, AnswerValue> | Array<{ question_id: string; answer: AnswerValue }>
  website?: string | null
  elapsed_ms: number
}

type Question = {
  id: string
  question_text: string
  type: string
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

function isMissingColumn(dbError: any): boolean {
  const code = String(dbError?.code ?? '')
  const message = String(dbError?.message ?? '')
  return code === '42703' || code === 'PGRST204' || /column .* does not exist/i.test(message)
}

function windowDate(value: unknown): Date {
  if (typeof value === 'number') {
    return new Date(value < 1e12 ? value * 1000 : value)
  }
  return new Date(String(value))
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

/** `rate_limits` tablosunda 1 saatlik pencereyi atomik olmayan şekilde günceller. */
async function enforceRateLimit(client: any, key: string, limit: number): Promise<boolean> {
  const now = new Date()
  const windowStartMs = now.getTime() - 60 * 60 * 1000
  let column = 'window_start'
  let result = await client.from('rate_limits').select('count, window_start').eq('key', key).maybeSingle()
  if (result.error && isMissingColumn(result.error)) {
    column = 'created_at'
    result = await client.from('rate_limits').select('count, created_at').eq('key', key).maybeSingle()
  }
  if (result.error) return false

  const row = result.data as Record<string, unknown> | null
  const startedAt = row ? windowDate(row[column]).getTime() : Number.NaN
  if (row && Number.isFinite(startedAt) && startedAt > windowStartMs) {
    const count = Number(row.count ?? 0)
    if (count >= limit) return false
    const updated = await client.from('rate_limits').update({ count: count + 1 }).eq('key', key)
    if (updated.error) return false
    return true
  }
  const upsert = await client
    .from('rate_limits')
    .upsert({ key, count: 1, [column]: now.toISOString() }, { onConflict: 'key' })
  if (upsert.error) return false
  return true
}

function normalizeAnswers(
  answers: ApplicationData['answers'],
): Record<string, AnswerValue> {
  if (Array.isArray(answers)) {
    const result: Record<string, AnswerValue> = {}
    for (const entry of answers) result[entry.question_id] = entry.answer
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
  switch (question.type) {
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
  const checked = await validate<ApplicationData>('application', parsed.data)
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
  const ipKey = `ip:${hashIp(ip, env('RATE_LIMIT_SALT') ?? '')}`
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
  const coreRow = {
    tracking_no: trackingNo,
    position_slug: data.position_slug,
    status: 'pending',
    applicant_name: data.applicant_name,
    applicant_email: data.applicant_email,
    discord_username: data.discord_username,
    submitted_at: submittedAt,
  }

  // Şema uyumluluğu için yaş/saat ve belirteç sütun adlarının olası varyantları.
  const insertVariants = [
    { ...coreRow, age: data.age, hours_per_week: data.hours_per_week, query_token_hash: tokenHash },
    { ...coreRow, age: data.age, hours_per_week: data.hours_per_week, query_token: tokenHash },
    { ...coreRow, query_token_hash: tokenHash },
    { ...coreRow, query_token: tokenHash },
  ]
  let inserted: any = null
  for (const row of insertVariants) {
    inserted = await client.from('applications').insert(row).select('id, tracking_no').single()
    if (!inserted.error || !isMissingColumn(inserted.error)) break
  }
  if (inserted.error || !inserted.data) return error(defaultMessage(500), 500, 'database')

  const applicationId = inserted.data.id as string
  const answerRows = questions
    .filter((question) => !isEmptyAnswer(submitted[question.id]))
    .map((question) => {
      const value = submitted[question.id]
      const options = optionsByQuestion.get(question.id) ?? []
      return {
        application_id: applicationId,
        question_id: question.id,
        question_text: question.question_text,
        question_type: question.type,
        options_snapshot: options.map((option) => ({
          label: option.label,
          value: option.value,
          sort_order: option.sort_order ?? 0,
        })),
        answer_text: typeof value === 'string' ? value : JSON.stringify(value),
        answer_value: Array.isArray(value) ? value.join(',') : String(value),
      }
    })
  if (answerRows.length > 0) {
    let answersInsert = await client.from('application_answers').insert(answerRows)
    if (answersInsert.error && isMissingColumn(answersInsert.error)) {
      answersInsert = await client
        .from('application_answers')
        .insert(
          answerRows.map((row) => ({
            application_id: row.application_id,
            question_id: row.question_id,
            answer_text: row.answer_text,
            answer_value: row.answer_value,
          })),
        )
    }
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
