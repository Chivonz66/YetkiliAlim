// Puanlar ve özel notlar. Kriter ağırlıkları veritabanından okunur, toplam 100'ü aşamaz.
import { requireAdmin } from '../_shared/auth.ts'
import { preflight, withCors } from '../_shared/cors.ts'
import { getAdminClient, writeAudit } from '../_shared/db.ts'
import {
  SCORE_CRITERIA,
  validateScorePayload,
} from '../_shared/pure.ts'
import { defaultMessage, error, json } from '../_shared/responses.ts'
import { readJson, validate } from '../_shared/validation.ts'

type ScoreData = { application_id: string; scores: Record<string, number>; note?: string }
type NoteData = { application_id: string; note: string }

async function loadWeights(client: any): Promise<Record<string, number>> {
  const weights: Record<string, number> = {}
  try {
    const result = await client.from('score_criteria').select('criterion_key, weight')
    if (result.error || !Array.isArray(result.data)) return weights
    for (const row of result.data) {
      const value = Number(row.weight)
      if (typeof row.criterion_key === 'string' && Number.isFinite(value)) {
        weights[row.criterion_key] = value
      }
    }
  } catch {
    // Tablo okunamazsa SCORE_CRITERIA sabit ağırlıkları kullanılır.
  }
  return weights
}

function weightFor(criterion: string, weights: Record<string, number>): number {
  const fallback = SCORE_CRITERIA.find((item) => item.key === criterion)?.weight ?? 0
  const value = Number(weights[criterion])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

async function run(req: Request): Promise<Response> {
  const method = req.method
  const url = new URL(req.url)
  const auth = await requireAdmin(req, { csrf: method !== 'GET' })
  if (!auth.ok) return auth.response
  const db = await getAdminClient()
  if (!db.ok) return error(db.error, 503, 'configuration')
  const client = db.client

  try {
    if (method === 'GET') {
      const id = url.searchParams.get('application_id') ?? url.searchParams.get('id')
      if (!id) return error('Başvuru kimliği belirtilmeli.', 400, 'validation')
      const [scores, notes] = await Promise.all([
        client.from('application_scores').select('*').eq('application_id', id),
        client.from('application_notes').select('*').eq('application_id', id).order('created_at', { ascending: false }),
      ])
      if (scores.error || notes.error) return error(defaultMessage(500), 500, 'database')
      return json({ ok: true, scores: scores.data ?? [], notes: notes.data ?? [] })
    }
    if (method !== 'POST') return error(defaultMessage(405), 405, 'method_not_allowed')

    const parsed = await readJson(req)
    if (!parsed.ok) return error(parsed.error, 400, 'invalid_body')
    const body = parsed.data as Record<string, unknown>
    const isNote =
      body.action === 'note' ||
      body.action === 'notes' ||
      /\/notes?\/?$/.test(url.pathname)

    if (isNote) {
      const checked = await validate<NoteData>('note', body)
      if (!checked.ok) return error(checked.error, 400, 'validation')
      const inserted = await client
        .from('application_notes')
        .insert({
          application_id: checked.data.application_id,
          admin_id: auth.adminId,
          note: checked.data.note,
        })
        .select('*')
        .single()
      if (inserted.error || !inserted.data) return error(defaultMessage(500), 500, 'database')
      await writeAudit(client, auth.adminId, 'note_create', 'application_notes', inserted.data.id, {
        application_id: checked.data.application_id,
      })
      return json({ ok: true, note: inserted.data }, 201)
    }

    const checked = await validate<ScoreData>('score', body)
    if (!checked.ok) return error(checked.error, 400, 'validation')
    const { application_id, scores } = checked.data
    const known = Object.keys(scores).every((key) => SCORE_CRITERIA.some((c) => c.key === key))
    if (!known || Object.keys(scores).length === 0) {
      return error('Bilinmeyen puan kriteri veya boş puan verisi.', 400, 'validation')
    }

    const existingResult = await client
      .from('application_scores')
      .select('criterion_key, points')
      .eq('application_id', application_id)
    if (existingResult.error) return error(defaultMessage(500), 500, 'database')
    const merged: Record<string, number> = {}
    for (const row of existingResult.data ?? []) {
      if (typeof row.criterion_key === 'string' && typeof row.points === 'number') {
        merged[row.criterion_key] = row.points
      }
    }
    Object.assign(merged, scores)
    const weights = await loadWeights(client)
    const validation = validateScorePayload(merged, weights)
    if (!validation.valid) return error(validation.error ?? 'Puanlar geçersiz.', 400, 'validation')

    for (const [criterion, score] of Object.entries(scores)) {
      const weightSnapshot = weightFor(criterion, weights)
      if (Number(score) > weightSnapshot) {
        return error(`${criterion} puanı kaydedilen ağırlığı (${weightSnapshot}) aşamaz.`, 400, 'validation')
      }
      const upsert = await client.from('application_scores').upsert(
        {
          application_id,
          criterion_key: criterion,
          points: score,
          weight_snapshot: weightSnapshot,
          scored_by: auth.adminId,
        },
        { onConflict: 'application_id,criterion_key' },
      )
      if (upsert.error) return error(defaultMessage(500), 500, 'database')
    }

    await writeAudit(client, auth.adminId, 'scores_update', 'applications', application_id, {
      scores,
      total: validation.total,
    })
    return json({ ok: true, total_score: validation.total })
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
