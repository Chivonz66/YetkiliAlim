// Soru yönetimi: tüm değişiklikler yönetici oturumu + CSRF gerektirir ve denetlenir.
import { requireAdmin } from '../_shared/auth.ts'
import { preflight, withCors } from '../_shared/cors.ts'
import { getAdminClient, writeAudit } from '../_shared/db.ts'
import { defaultMessage, error, json } from '../_shared/responses.ts'
import { readJson, validate } from '../_shared/validation.ts'

type QuestionBody = Record<string, any>

async function loadAll(client: any): Promise<Response> {
  const questions = await client.from('questions').select('*').order('sort_order', { ascending: true })
  if (questions.error) return error(defaultMessage(500), 500, 'database')
  const options = await client
    .from('question_options')
    .select('*')
    .order('sort_order', { ascending: true })
  if (options.error) return error(defaultMessage(500), 500, 'database')
  const byQuestion = new Map<string, unknown[]>()
  for (const option of options.data ?? []) {
    const list = byQuestion.get(option.question_id) ?? []
    list.push(option)
    byQuestion.set(option.question_id, list)
  }
  const items = (questions.data ?? []).map((question: any) => ({
    ...question,
    options: byQuestion.get(question.id) ?? [],
  }))
  return json({ ok: true, questions: items })
}

async function saveOptions(client: any, questionId: string, options: unknown[]): Promise<string | null> {
  if (!Array.isArray(options)) return null
  const removed = await client.from('question_options').delete().eq('question_id', questionId)
  if (removed.error) return defaultMessage(500)
  if (options.length === 0) return null
  const rows = options.map((option: any, index: number) => ({
    question_id: questionId,
    label: option.label,
    value: option.value,
    sort_order: option.sort_order ?? index,
    is_active: option.is_active ?? true,
  }))
  const inserted = await client.from('question_options').insert(rows)
  if (inserted.error) return defaultMessage(500)
  return null
}

async function run(req: Request): Promise<Response> {
  const method = req.method
  const url = new URL(req.url)
  const isReorder = /\/reorder\/?$/.test(url.pathname)

  const auth = await requireAdmin(req, { csrf: method !== 'GET' })
  if (!auth.ok) return auth.response
  const db = await getAdminClient()
  if (!db.ok) return error(db.error, 503, 'configuration')
  const client = db.client

  try {
    if (method === 'GET') return await loadAll(client)

    const parsed = await readJson(req)
    if (!parsed.ok) return error(parsed.error, 400, 'invalid_body')
    const body = parsed.data as QuestionBody

    if (method === 'POST' && (isReorder || body.action === 'reorder')) {
      const checked = await validate<{ ids: string[] }>('reorder', body)
      if (!checked.ok) return error(checked.error, 400, 'validation')
      for (let index = 0; index < checked.data.ids.length; index += 1) {
        const updated = await client
          .from('questions')
          .update({ sort_order: index })
          .eq('id', checked.data.ids[index])
        if (updated.error) return error(defaultMessage(500), 500, 'database')
      }
      await writeAudit(client, auth.adminId, 'question_reorder', 'questions', null, {
        ids: checked.data.ids,
      })
      return json({ ok: true })
    }

    if (method === 'POST') {
      const checked = await validate<QuestionBody>('question', body)
      if (!checked.ok) return error(checked.error, 400, 'validation')
      const { options, ...fields } = checked.data
      const inserted = await client.from('questions').insert(fields).select('*').single()
      if (inserted.error || !inserted.data) return error(defaultMessage(500), 500, 'database')
      const optionError = await saveOptions(client, inserted.data.id, options ?? [])
      if (optionError) return error(optionError, 500, 'database')
      await writeAudit(client, auth.adminId, 'question_create', 'questions', inserted.data.id, {})
      const fresh = await client.from('questions').select('*').eq('id', inserted.data.id).single()
      const savedOptions = await client.from('question_options').select('*').eq('question_id', inserted.data.id)
      return json(
        {
          ok: true,
          question: { ...(fresh.data ?? inserted.data), options: savedOptions.data ?? [] },
        },
        201,
      )
    }

    if (method === 'PATCH') {
      const id = body.id ?? url.searchParams.get('id')
      if (typeof id !== 'string' || !id) return error('Soru kimliği belirtilmeli.', 400, 'validation')
      const checked = await validate<QuestionBody>('questionPatch', body)
      if (!checked.ok) return error(checked.error, 400, 'validation')
      const { options, ...fields } = checked.data
      let updated: any = { data: null, error: null }
      if (Object.keys(fields).length > 0) {
        updated = await client.from('questions').update(fields).eq('id', id).select('*').maybeSingle()
        if (updated.error) return error(defaultMessage(500), 500, 'database')
        if (!updated.data) return error(defaultMessage(404), 404, 'not_found')
      }
      if (options !== undefined) {
        const optionError = await saveOptions(client, id, options)
        if (optionError) return error(optionError, 500, 'database')
      }
      await writeAudit(client, auth.adminId, 'question_update', 'questions', id, {
        fields: Object.keys(fields),
      })
      const fresh = await client.from('questions').select('*').eq('id', id).single()
      const savedOptions = await client.from('question_options').select('*').eq('question_id', id)
      return json({
        ok: true,
        question: { ...(fresh.data ?? updated.data ?? {}), options: savedOptions.data ?? [] },
      })
    }

    if (method === 'DELETE') {
      const id = body.id ?? url.searchParams.get('id')
      if (typeof id !== 'string' || !id) return error('Soru kimliği belirtilmeli.', 400, 'validation')
      const removedOptions = await client.from('question_options').delete().eq('question_id', id)
      if (removedOptions.error) return error(defaultMessage(500), 500, 'database')
      const removed = await client.from('questions').delete().eq('id', id).select('id').maybeSingle()
      if (removed.error) return error(defaultMessage(500), 500, 'database')
      await writeAudit(client, auth.adminId, 'question_delete', 'questions', id, {})
      return json({ ok: true })
    }

    return error(defaultMessage(405), 405, 'method_not_allowed')
  } catch {
    return error(defaultMessage(500), 500, 'internal')
  }
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
