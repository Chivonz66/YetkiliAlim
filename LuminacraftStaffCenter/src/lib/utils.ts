import type { QuestionType } from '../types'

// Karışıklığa yol açan 0/O/1/I karakterleri çıkarıldı.
const TRACKING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const HEX_ALPHABET = '0123456789abcdef'

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  return bytes
}

/** LSC-YYYY-XXXXXX biçiminde, okunaklı ve benzersiz başvuru numarası üretir. */
export function generateTrackingNo(date: Date = new Date()): string {
  const year = date.getFullYear()
  const bytes = randomBytes(6)
  let suffix = ''
  for (const byte of bytes) {
    suffix += TRACKING_ALPHABET[byte % TRACKING_ALPHABET.length]
  }
  return `LSC-${year}-${suffix}`
}

/** Başvuru takibi için 64 karakterli (32 bayt) hex sorgu anahtarı üretir. */
export function generateQueryToken(): string {
  const bytes = randomBytes(32)
  let token = ''
  for (const byte of bytes) {
    token += HEX_ALPHABET[byte >> 4] + HEX_ALPHABET[byte & 0x0f]
  }
  return token
}

function toDate(iso: string): Date | null {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Tarihi tr-TR yerel biçiminde gösterir. */
export function formatDate(iso: string): string {
  const date = toDate(iso)
  if (!date) return '—'
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

/** Tarih ve saati tr-TR yerel biçiminde gösterir. */
export function formatDateTime(iso: string): string {
  const date = toDate(iso)
  if (!date) return '—'
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Kullanıcı girdisini HTML olarak güvenli hale getirir. */
export function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (character) => HTML_ENTITIES[character] ?? character)
}

/** Metin uzunluğu için alt/üst sınır kontrolü; hata mesajı veya null döner. */
export function validateMinMax(value: string, min?: number, max?: number): string | null {
  const text = String(value ?? '')
  if (min !== undefined && min !== null && text.length < min) {
    return `Bu alan en az ${min} karakter olmalıdır.`
  }
  if (max !== undefined && max !== null && text.length > max) {
    return `Bu alan en fazla ${max} karakter olabilir.`
  }
  return null
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

interface AnswerValidationOptions {
  required?: boolean
  minLength?: number
  maxLength?: number
  options?: string[]
}

/** Soru tipine ve seçenek kurallarına göre cevabın geçerli olup olmadığını kontrol eder. */
export function isAnswerValid(
  type: QuestionType,
  value: unknown,
  opts: AnswerValidationOptions = {},
): boolean {
  const required = opts.required === true
  if (isEmpty(value)) return !required

  const allowed = opts.options?.filter((option) => typeof option === 'string')

  switch (type) {
    case 'short_text':
    case 'long_text': {
      if (typeof value !== 'string') return false
      const text = value.trim()
      return validateMinMax(text, opts.minLength, opts.maxLength) === null
    }
    case 'number': {
      const numeric = typeof value === 'number' ? value : Number(String(value).trim())
      if (!Number.isFinite(numeric)) return false
      if (opts.minLength !== undefined && numeric < opts.minLength) return false
      if (opts.maxLength !== undefined && numeric > opts.maxLength) return false
      return true
    }
    case 'single_choice': {
      if (typeof value !== 'string') return false
      return !allowed || allowed.includes(value)
    }
    case 'multiple_choice': {
      const values = Array.isArray(value) ? value : [value]
      if (!values.every((item) => typeof item === 'string')) return false
      if (allowed && !values.every((item) => allowed.includes(item as string))) return false
      return required ? values.length > 0 : true
    }
    case 'yes_no': {
      if (typeof value === 'boolean') return true
      if (typeof value !== 'string') return false
      return ['yes', 'no', 'true', 'false', 'evet', 'hayır', 'hayir'].includes(
        value.trim().toLowerCase(),
      )
    }
    case 'checkbox': {
      if (typeof value === 'boolean') return required ? value : true
      if (typeof value === 'string') {
        return ['true', '1', 'evet', 'yes'].includes(value.trim().toLowerCase())
          ? true
          : !required
      }
      return !required
    }
    default:
      return false
  }
}

/** Puanı 0-100 aralığında tutar. */
export function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n))
}

/** Koşullu Tailwind sınıflarını birleştirir. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}
