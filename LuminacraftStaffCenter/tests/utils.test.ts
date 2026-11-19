import { describe, expect, it } from 'vitest'
import {
  clampScore,
  cn,
  escapeHtml,
  formatDate,
  formatDateTime,
  generateQueryToken,
  generateTrackingNo,
  isAnswerValid,
  validateMinMax,
} from '../src/lib/utils'
import { QUESTION_TYPES, SCORE_CRITERIA } from '../src/lib/constants'
import type { QuestionType } from '../src/types'

describe('generateTrackingNo', () => {
  it('LSC-YYYY-XXXXXX biçiminde döner', () => {
    const value = generateTrackingNo(new Date(2026, 0, 15))
    expect(value).toMatch(/^LSC-2026-[A-Z2-9]{6}$/)
    // Rastgele kısıfta karışıklığa yol açan karakterler kullanılmaz.
    expect(value.slice(-6)).not.toMatch(/[0O1I]/)
  })

  it('ardışık çağrılarda (büyük olasılıkla) benzersiz değerler üretir', () => {
    const values = new Set(Array.from({ length: 250 }, () => generateTrackingNo()))
    expect(values.size).toBeGreaterThan(240)
  })
})

describe('generateQueryToken', () => {
  it('en az 32 hex karakter döner ve benzersizdir', () => {
    const first = generateQueryToken()
    const second = generateQueryToken()
    expect(first).toMatch(/^[0-9a-f]{32,}$/)
    expect(first).toHaveLength(64)
    expect(first).not.toBe(second)
  })
})

describe('tarih biçimlendirme', () => {
  it('tr-TR biçiminde tarih ve tarih-saat üretir', () => {
    const iso = '2026-01-15T10:30:00Z'
    expect(formatDate(iso)).toContain('2026')
    expect(formatDateTime(iso)).toContain('2026')
    expect(formatDate('gecersiz')).toBe('—')
  })
})

describe('escapeHtml', () => {
  it('özel karakterleri HTML varlıklarına çevirir', () => {
    expect(escapeHtml('<script>alert("x") & \'y\'</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;',
    )
  })

  it('sade metni değiştirmez', () => {
    expect(escapeHtml('Luminacraft Rehber')).toBe('Luminacraft Rehber')
  })
})

describe('validateMinMax', () => {
  it('sınırları dahil kabul eder', () => {
    expect(validateMinMax('abc', 3, 5)).toBeNull()
    expect(validateMinMax('abcde', 3, 5)).toBeNull()
  })

  it('sınır dışındaki değerlerde Türkçe hata döner', () => {
    expect(validateMinMax('ab', 3)).toContain('en az 3')
    expect(validateMinMax('abcdef', undefined, 5)).toContain('en fazla 5')
  })
})

describe('isAnswerValid — tüm soru tipleri', () => {
  const types: QuestionType[] = [
    'short_text',
    'long_text',
    'number',
    'single_choice',
    'multiple_choice',
    'yes_no',
    'checkbox',
  ]

  it('yedi soru tipinin tamamı desteklenir', () => {
    for (const type of types) {
      expect(typeof isAnswerValid(type, 'geçerli')).toBe('boolean')
    }
  })

  it('zorunlu sorularda boş cevap reddedilir, isteğe bağlıda kabul edilir', () => {
    for (const type of types) {
      expect(isAnswerValid(type, '', { required: true })).toBe(false)
      expect(isAnswerValid(type, '', { required: false })).toBe(true)
      expect(isAnswerValid(type, null, { required: true })).toBe(false)
    }
  })

  it('short_text: uzunluk sınırları uygulanır', () => {
    expect(isAnswerValid('short_text', 'Merhaba')).toBe(true)
    expect(isAnswerValid('short_text', 'Merhaba', { minLength: 10 })).toBe(false)
    expect(isAnswerValid('short_text', 'Merhaba', { maxLength: 7 })).toBe(true)
    expect(isAnswerValid('short_text', 'Merhaba', { maxLength: 6 })).toBe(false)
  })

  it('long_text: çok satırlı metin ve sınırlar', () => {
    expect(isAnswerValid('long_text', 'Uzun açıklama\nikinci satır', { minLength: 5 })).toBe(true)
    expect(isAnswerValid('long_text', 'kısa', { minLength: 10 })).toBe(false)
  })

  it('number: yalnızca sayısal değerler', () => {
    expect(isAnswerValid('number', '42')).toBe(true)
    expect(isAnswerValid('number', 42)).toBe(true)
    expect(isAnswerValid('number', 'abc')).toBe(false)
    expect(isAnswerValid('number', '5', { minLength: 10 })).toBe(false)
    expect(isAnswerValid('number', '50', { maxLength: 10 })).toBe(false)
  })

  it('single_choice: seçenek listesine göre doğrular', () => {
    const options = ['Evet', 'Hayır', 'Belki']
    expect(isAnswerValid('single_choice', 'Evet', { options })).toBe(true)
    expect(isAnswerValid('single_choice', 'Yanlış', { options })).toBe(false)
    expect(isAnswerValid('single_choice', 'Serbest')).toBe(true)
  })

  it('multiple_choice: diziyi ve seçenekleri doğrular', () => {
    const options = ['A', 'B', 'C']
    expect(isAnswerValid('multiple_choice', ['A', 'C'], { options, required: true })).toBe(true)
    expect(isAnswerValid('multiple_choice', ['Z'], { options })).toBe(false)
    expect(isAnswerValid('multiple_choice', [], { required: true })).toBe(false)
    expect(isAnswerValid('multiple_choice', [], { required: false })).toBe(true)
  })

  it('yes_no: evet/hayır ve boolean değerleri kabul eder', () => {
    expect(isAnswerValid('yes_no', 'evet', { required: true })).toBe(true)
    expect(isAnswerValid('yes_no', false, { required: true })).toBe(true)
    expect(isAnswerValid('yes_no', 'belki', { required: true })).toBe(false)
  })

  it('checkbox: zorunlu onay için true ister', () => {
    expect(isAnswerValid('checkbox', true, { required: true })).toBe(true)
    expect(isAnswerValid('checkbox', false, { required: true })).toBe(false)
    expect(isAnswerValid('checkbox', false, { required: false })).toBe(true)
  })
})

describe('clampScore', () => {
  it('değeri 0-100 aralığında tutar', () => {
    expect(clampScore(-10)).toBe(0)
    expect(clampScore(0)).toBe(0)
    expect(clampScore(45.5)).toBe(45.5)
    expect(clampScore(100)).toBe(100)
    expect(clampScore(250)).toBe(100)
    expect(clampScore(Number.NaN)).toBe(0)
  })
})

describe('cn', () => {
  it('yalnızca geçerli sınıfları birleştirir', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b')
  })
})

describe('sabitler', () => {
  it('SCORE_CRITERIA toplamı 100 eder', () => {
    expect(SCORE_CRITERIA).toHaveLength(6)
    expect(SCORE_CRITERIA.reduce((sum, criterion) => sum + criterion.max, 0)).toBe(100)
    expect(SCORE_CRITERIA.map((criterion) => criterion.label)).toEqual([
      'İletişim',
      'Bilgi seviyesi',
      'Sorumluluk',
      'Problem çözme',
      'Deneyim',
      'Pozisyona uygunluk',
    ])
  })

  it('QUESTION_TYPES tam olarak yedi geçerli değer içerir', () => {
    expect(QUESTION_TYPES.map((item) => item.value)).toEqual([
      'short_text',
      'long_text',
      'number',
      'single_choice',
      'multiple_choice',
      'yes_no',
      'checkbox',
    ])
  })
})
