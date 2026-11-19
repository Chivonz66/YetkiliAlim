/**
 * Başvuru puanlama ve görüntüleme yardımcıları (tamamen saf fonksiyonlar).
 * Ağırlıklar tek doğruluk kaynağı olan `SCORE_CRITERIA` sabitinden gelir.
 */
import { APPLICATION_STATUSES, SCORE_CRITERIA } from './constants'
import { clampScore } from './utils'
import type { ApplicationStatus } from '../types'

export type ScoreMap = Record<string, unknown>

function numericScore(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : 0
}

/**
 * Bilinen kriterlerin puanlarını kendi ağırlıklarıyla sınırlayıp toplar.
 * Bilinmeyen kriterler yok sayılır; sonuç her zaman 0-100 aralığındadır.
 */
export function calculateTotal(scores: ScoreMap | null | undefined): number {
  if (!scores || typeof scores !== 'object') return 0
  let total = 0
  for (const criterion of SCORE_CRITERIA) {
    if (!(criterion.key in scores)) continue
    const bounded = Math.min(criterion.weight, Math.max(0, numericScore(scores[criterion.key])))
    total += bounded
  }
  return clampScore(total)
}

/** Puan verisinin sunucu kurallarına uygun olup olmadığını kontrol eder. */
export function isScoreValid(scores: ScoreMap | null | undefined): boolean {
  if (!scores || typeof scores !== 'object') return false
  const entries = Object.entries(scores).filter(
    ([, value]) => value !== null && value !== undefined && String(value).trim() !== '',
  )
  if (entries.length === 0) return false

  for (const [key, value] of entries) {
    const criterion = SCORE_CRITERIA.find((item) => item.key === key)
    if (!criterion) return false
    const number = numericScore(value)
    if (!Number.isFinite(number) || number < 0 || number > criterion.weight) return false
  }
  return calculateTotal(scores) <= 100
}

/** Toplam puanı 0-100 yüzdesine çevirir. */
export function scorePercent(total: number, max: number = 100): number {
  const upper = Number.isFinite(max) && max > 0 ? max : 100
  const value = Number.isFinite(total) ? total : 0
  return clampScore(Math.round((value / upper) * 100))
}

/** Puan listesinin ortalamasını (bir ondalık basamak) döndürür; boşsa 0. */
export function averageScore(
  list: Array<number | null | undefined | { total_score?: unknown; score?: unknown }> | null | undefined,
): number {
  if (!Array.isArray(list) || list.length === 0) return 0
  const values: number[] = []
  for (const item of list) {
    if (item === null || item === undefined) continue
    const raw = typeof item === 'number' ? item : item.total_score ?? item.score
    const number = typeof raw === 'number' ? raw : Number(raw)
    if (Number.isFinite(number)) values.push(clampScore(number))
  }
  if (values.length === 0) return 0
  const sum = values.reduce((total, value) => total + value, 0)
  return Math.round((sum / values.length) * 10) / 10
}

/** Başvuru durumunun yönetici panelindeki Türkçe karşılığı. */
export function statusLabel(status: ApplicationStatus | string | null | undefined): string {
  if (!status) return 'Bilinmiyor'
  return APPLICATION_STATUSES.find((item) => item.value === status)?.label ?? 'Bilinmiyor'
}

/** Cevap değerini yönetici panelinde okunabilir metne dönüştürür. */
export function formatAnswerValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (Array.isArray(value)) {
    const items = value.map((item) => formatAnswerValue(item)).filter((item) => item !== '—')
    return items.length > 0 ? items.join(', ') : '—'
  }
  if (typeof value === 'boolean') return value ? 'Evet' : 'Hayır'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '—'
  if (typeof value === 'string') return value.trim() || '—'
  if (typeof value === 'object') {
    try {
      const json = JSON.stringify(value)
      return json && json !== '{}' ? json : '—'
    } catch {
      return '—'
    }
  }
  return String(value)
}

export const SCORE_TOTAL_WEIGHT = SCORE_CRITERIA.reduce((total, item) => total + item.weight, 0)
