import { describe, expect, it } from 'vitest'
import {
  QUESTION_TYPES,
  SCORE_CRITERIA,
  base64urlDecode,
  buildAuditRow,
  canRetryNotification,
  createTrackingNo,
  dailyActivityToHours,
  decodeSessionPayload,
  encodeSessionPayload,
  getAllowedOrigins,
  hashIp,
  isAllowedOrigin,
  isHumanSubmission,
  isValidAge,
  isValidDiscordUsername,
  isValidHours,
  isValidMinecraftUsername,
  isValidQuestionType,
  isValidTrackingNo,
  signSessionToken,
  timingSafeEqualHex,
  validateScorePayload,
  verifyPasswordHashFormat,
  verifySessionToken,
} from '../supabase/functions/_shared/pure.ts'

const VALID_HASH = ['pbkdf2', '210000', 'a'.repeat(32), 'b'.repeat(64)].join('$')

describe('verifyPasswordHashFormat', () => {
  it('210000 tur, 16 bayt tuz ve 32 bayt anahtar biçimini kabul eder', () => {
    expect(verifyPasswordHashFormat(VALID_HASH)).toBe(true)
    expect(verifyPasswordHashFormat(VALID_HASH.toUpperCase().replace('PBKDF2', 'pbkdf2'))).toBe(true)
  })

  it('bozuk biçimleri reddeder', () => {
    expect(verifyPasswordHashFormat('pbkdf2$100000$' + 'a'.repeat(32) + '$' + 'b'.repeat(64))).toBe(false)
    expect(verifyPasswordHashFormat('pbkdf2$210000$abc$' + 'b'.repeat(64))).toBe(false)
    expect(verifyPasswordHashFormat('plain-password')).toBe(false)
    expect(verifyPasswordHashFormat(null)).toBe(false)
    expect(verifyPasswordHashFormat(undefined)).toBe(false)
  })
})

describe('timingSafeEqualHex', () => {
  it('aynı onaltılık değerler için doğru döner', () => {
    expect(timingSafeEqualHex('a1b2c3d4', 'a1b2c3d4')).toBe(true)
    expect(timingSafeEqualHex('A1B2', 'a1b2')).toBe(true)
  })

  it('farklı ve kısa girdiler için yanlış döner', () => {
    expect(timingSafeEqualHex('a1b2c3d4', 'a1b2c3d5')).toBe(false)
    expect(timingSafeEqualHex('ab', 'abcd')).toBe(false)
    expect(timingSafeEqualHex('', '')).toBe(false)
    expect(timingSafeEqualHex('zz', 'zz')).toBe(false)
    expect(timingSafeEqualHex('ab', null)).toBe(false)
  })
})

describe('hashIp', () => {
  it('aynı IP ve tuz için deterministik 64 karakterli özet üretir', () => {
    const first = hashIp('203.0.113.10', 'test-salt')
    expect(first).toBe(hashIp('203.0.113.10', 'test-salt'))
    expect(first).toMatch(/^[0-9a-f]{64}$/)
  })

  it('tuz veya IP değişirse özet değişir', () => {
    expect(hashIp('203.0.113.10', 'salt-a')).not.toBe(hashIp('203.0.113.10', 'salt-b'))
    expect(hashIp('203.0.113.10', 'salt-a')).not.toBe(hashIp('203.0.113.11', 'salt-a'))
  })
})

describe('takip numarası', () => {
  it('LSC-YYYY-XXXXXX biçimini doğrular', () => {
    expect(isValidTrackingNo('LSC-2026-A2B3C4')).toBe(true)
    expect(isValidTrackingNo('LSC-26-A2B3C4')).toBe(false)
    expect(isValidTrackingNo('lsc-2026-a2b3c4')).toBe(false)
    expect(isValidTrackingNo('LSC-2026-A2B3C')).toBe(false)
  })

  it('üretilen numara şablona uyar', () => {
    const bytes = new Uint8Array([1, 7, 13, 29, 61, 127, 200, 255])
    const value = createTrackingNo(2026, bytes)
    expect(value).toMatch(/^LSC-2026-[A-Z2-9]{6}$/)
    expect(isValidTrackingNo(value)).toBe(true)
  })
})

describe('soru tipleri', () => {
  it('tam olarak yedi geçerli değer içerir', () => {
    expect(QUESTION_TYPES).toEqual([
      'short_text',
      'long_text',
      'number',
      'single_choice',
      'multiple_choice',
      'yes_no',
      'checkbox',
    ])
  })

  it('doğrulama yalnızca bu değerleri kabul eder', () => {
    for (const type of QUESTION_TYPES) expect(isValidQuestionType(type)).toBe(true)
    expect(isValidQuestionType('text')).toBe(false)
    expect(isValidQuestionType(null)).toBe(false)
    expect(isValidQuestionType('')).toBe(false)
  })
})

describe('puan doğrulama', () => {
  it('ağırlıklara uyan altı kriter ve 100 toplamını kabul eder', () => {
    expect(SCORE_CRITERIA.map((item) => item.weight)).toEqual([20, 20, 15, 15, 15, 15])
    const scores = Object.fromEntries(SCORE_CRITERIA.map((item) => [item.key, item.weight]))
    const result = validateScorePayload(scores)
    expect(result.valid).toBe(true)
    expect(result.total).toBe(100)
  })

  it('kriter ağırlığını aşan puanı reddeder', () => {
    const result = validateScorePayload({ communication: 21 })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('en fazla 20')
  })

  it('toplam 100’ü aşan puanları reddeder', () => {
    const result = validateScorePayload(
      { communication: 60, knowledge: 60 },
      { communication: 100, knowledge: 100 },
    )
    expect(result.valid).toBe(false)
    expect(result.total).toBe(120)
    expect(result.error).toContain('100')
  })

  it('bilinmeyen kriteri ve negatif puanı reddeder', () => {
    expect(validateScorePayload({ unknown: 5 }).error).toContain('Bilinmeyen')
    expect(validateScorePayload({ communication: -1 }).valid).toBe(false)
  })
})

describe('CORS origin izin listesi', () => {
  it('yalnızca listelenen originleri kabul eder', () => {
    expect(isAllowedOrigin('https://staff.example.com', ['https://staff.example.com'])).toBe(true)
    expect(isAllowedOrigin('https://staff.example.com/', ['https://staff.example.com'])).toBe(true)
    expect(isAllowedOrigin('https://evil.example', ['https://staff.example.com'])).toBe(false)
    expect(isAllowedOrigin(null, ['https://staff.example.com'])).toBe(false)
    expect(isAllowedOrigin('https://staff.example.com', ['*'])).toBe(false)
  })

  it('virgülle ayrılmış ortam listesini ve yerel varsayılanı çözümler', () => {
    expect(getAllowedOrigins('https://a.example, https://b.example/')).toEqual([
      'https://a.example',
      'https://b.example',
    ])
    expect(getAllowedOrigins('')).toEqual([])
    expect(getAllowedOrigins(undefined)).toContain('http://localhost:5173')
  })
})

describe('oturum belirteci', () => {
  const payload = { sub: 'admin-1', exp: 2_000_000_000, nonce: 'abc123' }

  it('payload kodlama ve çözme turu yapar', () => {
    const encoded = encodeSessionPayload(payload)
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeSessionPayload(encoded)).toEqual(payload)
    expect(decodeSessionPayload('!!!')).toBeNull()
    expect(base64urlDecode(encoded).length).toBeGreaterThan(0)
  })

  it('imzayı doğrular, süresi dolan ve değiştirilen belirteci reddeder', () => {
    const token = signSessionToken(payload, 'gizli')
    expect(verifySessionToken(token, 'gizli', 1_900_000_000)).toEqual(payload)
    expect(verifySessionToken(token, 'baska-gizli', 1_900_000_000)).toBeNull()
    expect(verifySessionToken(token, 'gizli', 2_000_000_001)).toBeNull()
    expect(verifySessionToken(`${token}x`, 'gizli', 1_900_000_000)).toBeNull()
  })
})

describe('başvuru alan doğrulama', () => {
  it('Minecraft ve Discord kullanıcı adı sınırlarını uygular', () => {
    expect(isValidMinecraftUsername('Steve_12')).toBe(true)
    expect(isValidMinecraftUsername('ab')).toBe(false)
    expect(isValidMinecraftUsername('steve.exe')).toBe(false)
    expect(isValidDiscordUsername('player.name_2')).toBe(true)
    expect(isValidDiscordUsername('a')).toBe(false)
  })

  it('yaş, saat ve honeypot kurallarını uygular', () => {
    expect(isValidAge(16)).toBe(true)
    expect(isValidAge(99)).toBe(true)
    expect(isValidAge(15)).toBe(false)
    expect(isValidAge(100)).toBe(false)
    expect(isValidHours(0)).toBe(true)
    expect(isValidHours(24)).toBe(true)
    expect(isValidHours(25)).toBe(false)
    expect(isHumanSubmission('', 3000)).toBe(true)
    expect(isHumanSubmission('https://spam.example', 5000)).toBe(false)
    expect(isHumanSubmission('', 2999)).toBe(false)
  })
})

describe('şema sözleşmesi yardımcıları', () => {
  it('denetim satırını şema sütun adlarıyla üretir', () => {
    expect(buildAuditRow('admin-1', 'update_application', 'applications', 'app-1', { status: 'accepted' })).toEqual({
      actor_type: 'admin',
      actor_id: 'admin-1',
      action: 'update_application',
      target_table: 'applications',
      target_id: 'app-1',
      details: { status: 'accepted' },
    })
  })

  it('yönetici olmayan denetim satırını sistem olarak işaretler', () => {
    const row = buildAuditRow(null, 'cleanup', 'system', null)
    expect(row.actor_type).toBe('system')
    expect(row.actor_id).toBeNull()
    expect(row.target_id).toBeNull()
    expect(row.details).toEqual({})
  })

  it('yalnızca başarısız bildirimlerin yeniden gönderilmesine izin verir', () => {
    expect(canRetryNotification('failed')).toBe(true)
    expect(canRetryNotification('pending')).toBe(false)
    expect(canRetryNotification('sent')).toBe(false)
    expect(canRetryNotification(null)).toBe(false)
  })

  it('günlük aktivite değerlerini daily_hours aralığına eşler', () => {
    expect(dailyActivityToHours('her_gun')).toBe(6)
    expect(dailyActivityToHours('haftada_birkaç')).toBe(3)
    expect(dailyActivityToHours('haftada_bir')).toBe(1)
    expect(dailyActivityToHours('nadir')).toBe(0.5)
    expect(dailyActivityToHours(8)).toBe(8)
    expect(dailyActivityToHours(99)).toBe(24)
    expect(dailyActivityToHours('geçersiz')).toBe(0)
  })
})
