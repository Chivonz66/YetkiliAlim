import { afterEach, describe, expect, it, vi } from 'vitest'
import { SCORE_CRITERIA } from '../src/lib/constants'
import { ApiError, getCsrfCookie } from '../src/lib/api-admin'
import {
  averageScore,
  calculateTotal,
  formatAnswerValue,
  isScoreValid,
  SCORE_TOTAL_WEIGHT,
  scorePercent,
  statusLabel,
} from '../src/lib/scoring'

const FULL_SCORE = {
  communication: 20,
  knowledge: 20,
  responsibility: 15,
  problem_solving: 15,
  experience: 15,
  position_fit: 15,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('puan hesaplama', () => {
  it('ağırlıklara göre toplamı hesaplar', () => {
    expect(calculateTotal({ communication: 10, knowledge: 5, responsibility: 3 })).toBe(18)
  })

  it('tam puan verisinde 100 döndürür', () => {
    expect(calculateTotal(FULL_SCORE)).toBe(100)
  })

  it('kriter üst sınırını aşan puanları sınırlar ve 100ü geçmez', () => {
    const inflated = {
      communication: 999,
      knowledge: 999,
      responsibility: 999,
      problem_solving: 999,
      experience: 999,
      position_fit: 999,
    }
    expect(calculateTotal(inflated)).toBe(100)
    expect(calculateTotal({ communication: -20, knowledge: 10 })).toBe(10)
  })

  it('bilinmeyen kriterleri ve boş veriyi yok sayar', () => {
    expect(calculateTotal({ ...FULL_SCORE, unknown_criterion: 500 })).toBe(100)
    expect(calculateTotal(null)).toBe(0)
  })

  it('geçerli puan verisini kabul eder', () => {
    expect(isScoreValid(FULL_SCORE)).toBe(true)
    expect(isScoreValid({ communication: 12 })).toBe(true)
  })

  it('bilinmeyen kriter içeren puan verisini reddeder', () => {
    expect(isScoreValid({ communication: 10, gizli_kriter: 5 })).toBe(false)
  })

  it('negatif ve üst sınırı aşan puanları reddeder', () => {
    expect(isScoreValid({ communication: -1 })).toBe(false)
    expect(isScoreValid({ communication: 21 })).toBe(false)
    expect(isScoreValid({})).toBe(false)
  })
})

describe('puan yardımcıları', () => {
  it('scorePercent yüzdeyi 0-100 aralığında yuvarlar', () => {
    expect(scorePercent(85)).toBe(85)
    expect(scorePercent(85.6)).toBe(86)
    expect(scorePercent(180)).toBe(100)
    expect(scorePercent(-5)).toBe(0)
  })

  it('averageScore boş listede 0 döndürür', () => {
    expect(averageScore([])).toBe(0)
    expect(averageScore(null)).toBe(0)
  })

  it('averageScore sayı ve nesne listelerinin ortalamasını alır', () => {
    expect(averageScore([80, 60])).toBe(70)
    expect(averageScore([{ total_score: 90 }, { total_score: 60 }, { score: 75 }])).toBe(75)
    expect(averageScore([{ total_score: null }, 120])).toBe(100)
  })
})

describe('görüntüleme yardımcıları', () => {
  it('statusLabel dört durumun Türkçe karşılığını döndürür', () => {
    expect(statusLabel('pending')).toBe('Beklemede')
    expect(statusLabel('reviewing')).toBe('İnceleniyor')
    expect(statusLabel('accepted')).toBe('Kabul edildi')
    expect(statusLabel('rejected')).toBe('Reddedildi')
  })

  it('statusLabel bilinmeyen durumda güvenli metin döndürür', () => {
    expect(statusLabel('unknown')).toBe('Bilinmiyor')
    expect(statusLabel(null)).toBe('Bilinmiyor')
  })

  it('formatAnswerValue metin, dizi, boolean ve sayı değerlerini biçimlendirir', () => {
    expect(formatAnswerValue('  merhaba  ')).toBe('merhaba')
    expect(formatAnswerValue(['a', 'b'])).toBe('a, b')
    expect(formatAnswerValue(true)).toBe('Evet')
    expect(formatAnswerValue(false)).toBe('Hayır')
    expect(formatAnswerValue(42)).toBe('42')
    expect(formatAnswerValue(null)).toBe('—')
  })

  it('SCORE_CRITERIA ağırlıkları toplamı 100 eder', () => {
    expect(SCORE_TOTAL_WEIGHT).toBe(100)
    expect(SCORE_CRITERIA.reduce((sum, item) => sum + item.max, 0)).toBe(100)
  })
})

describe('api-admin yardımcıları', () => {
  it('getCsrfCookie lsc_csrf çerezini okur ve çözer', () => {
    vi.stubGlobal('document', { cookie: 'foo=bar; lsc_csrf=abc%2D123; other=1' })
    expect(getCsrfCookie()).toBe('abc-123')
  })

  it('getCsrfCookie çerez yoksa boş metin döndürür', () => {
    vi.stubGlobal('document', { cookie: 'foo=bar' })
    expect(getCsrfCookie()).toBe('')
  })

  it('ApiError mesaj, kod ve durum bilgisini taşır', () => {
    const error = new ApiError('Yetkisiz.', 'unauthorized', 401)
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ApiError')
    expect(error.message).toBe('Yetkisiz.')
    expect(error.code).toBe('unauthorized')
    expect(error.status).toBe(401)
  })
})
