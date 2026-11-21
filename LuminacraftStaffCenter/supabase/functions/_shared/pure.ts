// Saf yardımcılar. Deno, npm veya ağ bağımlılığı içermez; Node/Vitest altında
// doğrudan içe aktarılabilir. Tüm şifreleme yardımcıları kendi kendine yeterlidir.

// Yalnızca tip bildirimi: çalışma zamanında `typeof Deno` güvenlidir.
declare const Deno: { env: { get(key: string): string | undefined } }

/** Deno ve Node ortamlarında çalışan ortam değişkeni okuyucu. */
export const env = (key: string): string | undefined =>
  (typeof Deno !== 'undefined' ? Deno.env.get(key) : undefined) ??
  (typeof process !== 'undefined' ? process.env?.[key] : undefined)

// ---------------------------------------------------------------------------
// UTF-8 / SHA-256 / HMAC (senkron, saf)
// ---------------------------------------------------------------------------

function toUtf8Bytes(value: string): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code < 0x80) {
      out.push(code)
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1)
      const cp = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00)
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      )
      i += 1
    } else {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    }
  }
  return new Uint8Array(out)
}

function fromUtf8Bytes(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i]
    if (b < 0x80) {
      out += String.fromCharCode(b)
    } else if (b < 0xe0 && i + 1 < bytes.length) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f))
      i += 1
    } else if (b < 0xf0 && i + 2 < bytes.length) {
      out += String.fromCharCode(
        ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f),
      )
      i += 2
    } else if (i + 3 < bytes.length) {
      const cp =
        ((b & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f)
      const v = cp - 0x10000
      out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff))
      i += 3
    }
  }
  return out
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) out += bytes[i].toString(16).padStart(2, '0')
  return out
}

export function hexToBytes(hex: string): Uint8Array {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    return new Uint8Array(0)
  }
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
  0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
  0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
  0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
  0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
])

function rotr(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0
}

export function sha256Bytes(data: Uint8Array): Uint8Array {
  const total = (((data.length + 9 + 63) >> 6) << 6) || 64
  const buffer = new Uint8Array(total)
  buffer.set(data)
  buffer[data.length] = 0x80
  const view = new DataView(buffer.buffer)
  const bitLength = data.length * 8
  view.setUint32(total - 8, Math.floor(bitLength / 0x100000000))
  view.setUint32(total - 4, bitLength >>> 0)

  let h0 = 0x6a09e667
  let h1 = 0xbb67ae85
  let h2 = 0x3c6ef372
  let h3 = 0xa54ff53a
  let h4 = 0x510e527f
  let h5 = 0x9b05688c
  let h6 = 0x1f83d9ab
  let h7 = 0x5be0cd19
  const words = new Uint32Array(64)

  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i += 1) words[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(words[i - 15], 7) ^ rotr(words[i - 15], 18) ^ (words[i - 15] >>> 3)
      const s1 = rotr(words[i - 2], 17) ^ rotr(words[i - 2], 19) ^ (words[i - 2] >>> 10)
      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0
    }
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    let f = h5
    let g = h6
    let h = h7
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + s1 + ch + SHA256_K[i] + words[i]) >>> 0
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (s0 + maj) >>> 0
      h = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
    h5 = (h5 + f) >>> 0
    h6 = (h6 + g) >>> 0
    h7 = (h7 + h) >>> 0
  }

  const digest = new Uint8Array(32)
  const outView = new DataView(digest.buffer)
  ;[h0, h1, h2, h3, h4, h5, h6, h7].forEach((word, i) => outView.setUint32(i * 4, word))
  return digest
}

export function sha256Hex(input: string | Uint8Array): string {
  return bytesToHex(sha256Bytes(typeof input === 'string' ? toUtf8Bytes(input) : input))
}

export function hmacSha256Bytes(message: string | Uint8Array, secret: string | Uint8Array): Uint8Array {
  const keyInput = typeof secret === 'string' ? toUtf8Bytes(secret) : secret
  const key = keyInput.length > 64 ? sha256Bytes(keyInput) : keyInput
  const padded = new Uint8Array(64)
  padded.set(key)
  const inner = new Uint8Array(64)
  const outer = new Uint8Array(64)
  for (let i = 0; i < 64; i += 1) {
    inner[i] = padded[i] ^ 0x36
    outer[i] = padded[i] ^ 0x5c
  }
  const msg = typeof message === 'string' ? toUtf8Bytes(message) : message
  const innerData = new Uint8Array(64 + msg.length)
  innerData.set(inner)
  innerData.set(msg, 64)
  const innerHash = sha256Bytes(innerData)
  const outerData = new Uint8Array(96)
  outerData.set(outer)
  outerData.set(innerHash, 64)
  return sha256Bytes(outerData)
}

export function hmacSha256Hex(message: string | Uint8Array, secret: string | Uint8Array): string {
  return bytesToHex(hmacSha256Bytes(message, secret))
}

// ---------------------------------------------------------------------------
// Base64url ve oturum belirteci
// ---------------------------------------------------------------------------

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function base64urlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? toUtf8Bytes(input) : input
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0
    out += BASE64_CHARS[a >> 2]
    out += BASE64_CHARS[((a & 0x03) << 4) | (b >> 4)]
    out += i + 1 < bytes.length ? BASE64_CHARS[((b & 0x0f) << 2) | (c >> 6)] : ''
    out += i + 2 < bytes.length ? BASE64_CHARS[c & 0x3f] : ''
  }
  return out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function base64urlDecode(input: string): Uint8Array {
  if (typeof input !== 'string' || !/^[A-Za-z0-9_-]*$/.test(input)) return new Uint8Array(0)
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  const bytes: number[] = []
  for (let i = 0; i < padded.length; i += 4) {
    const chunk = padded.slice(i, i + 4)
    let n = 0
    for (let j = 0; j < 4; j += 1) {
      n = (n << 6) | (j < chunk.length ? BASE64_CHARS.indexOf(chunk[j]) : 0)
    }
    if (chunk.length >= 2) bytes.push((n >> 16) & 0xff)
    if (chunk.length >= 3) bytes.push((n >> 8) & 0xff)
    if (chunk.length >= 4) bytes.push(n & 0xff)
  }
  return new Uint8Array(bytes)
}

export interface SessionPayload {
  sub: string
  exp: number
  nonce: string
}

export function encodeSessionPayload(payload: SessionPayload): string {
  return base64urlEncode(JSON.stringify(payload))
}

export function decodeSessionPayload(value: string): SessionPayload | null {
  try {
    const parsed: unknown = JSON.parse(fromUtf8Bytes(base64urlDecode(value)))
    if (!parsed || typeof parsed !== 'object') return null
    const candidate = parsed as Record<string, unknown>
    if (
      typeof candidate.sub !== 'string' ||
      !candidate.sub ||
      typeof candidate.exp !== 'number' ||
      !Number.isFinite(candidate.exp) ||
      typeof candidate.nonce !== 'string' ||
      !candidate.nonce
    ) {
      return null
    }
    return { sub: candidate.sub, exp: candidate.exp, nonce: candidate.nonce }
  } catch {
    return null
  }
}

export function signSessionToken(payload: SessionPayload, secret: string): string {
  const encoded = encodeSessionPayload(payload)
  const signature = base64urlEncode(hexToBytes(hmacSha256Hex(encoded, secret)))
  return `${encoded}.${signature}`
}

export function verifySessionToken(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SessionPayload | null {
  if (!secret || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  const expected = hmacSha256Hex(parts[0], secret)
  const actual = bytesToHex(base64urlDecode(parts[1]))
  if (!timingSafeEqualHex(actual, expected)) return null
  const payload = decodeSessionPayload(parts[0])
  if (!payload || payload.exp <= nowSeconds) return null
  return payload
}

// ---------------------------------------------------------------------------
// Giriş kilidi ve oturum kaydı yardımcıları (Edge + Node/Vitest için saf)
// ---------------------------------------------------------------------------

// IP + kullanıcı adı başına 15 dakikalık pencerede en fazla 5 başarısız deneme.
export const LOGIN_MAX_ATTEMPTS = 5
export const LOGIN_WINDOW_MS = 15 * 60 * 1000
export const INVALID_CREDENTIALS_MESSAGE = 'Kullanıcı adı veya şifre hatalı.'
export const LOGIN_LOCKED_MESSAGE = 'Çok fazla başarısız giriş denemesi. Lütfen daha sonra tekrar deneyin.'

/** Ham IP'yi saklamadan istemci adresini okur (proxy başlıklarını dikkate alır). */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || req.headers.get('x-real-ip')?.trim() || 'unknown'
}

/** rate_limits anahtarı: ham IP ve kullanıcı adı asla diske yazılmaz. */
export function loginRateLimitKey(ip: string, username: string): string {
  return `admin_login:${sha256Hex(`${ip}|${username.trim().toLowerCase()}`)}`
}

/** Sabit 15 dakikalık pencereler, rate_limits.window_start ile uyumlu ISO tarih. */
export function loginWindowStart(now: Date = new Date()): string {
  return new Date(Math.floor(now.getTime() / LOGIN_WINDOW_MS) * LOGIN_WINDOW_MS).toISOString()
}

/** Beşinci başarısız denemeden sonraki istekler kilitlenir. */
export function isLoginLocked(hitCount: unknown, limit: number = LOGIN_MAX_ATTEMPTS): boolean {
  const count = typeof hitCount === 'number' ? hitCount : Number(hitCount)
  return Number.isFinite(count) && count >= limit
}

/** Oturum tablosunda saklanan tek doğrulayıcı: ham belirtecin sha256 özeti. */
export function sessionTokenHash(token: string): string {
  return sha256Hex(token)
}

export interface AdminSessionRow {
  admin_id: string
  expires_at: string
  revoked_at: string | null
}

/** Oturum kaydı iptal edilmemiş, süresi dolmamış ve yöneticiyle eşleşmiş olmalı. */
export function isActiveSession(
  row: AdminSessionRow | null | undefined,
  adminId: string,
  now: number = Date.now(),
): boolean {
  if (!row || row.admin_id !== adminId || row.revoked_at !== null) return false
  const expiresAt = Date.parse(row.expires_at)
  return Number.isFinite(expiresAt) && expiresAt > now
}

// ---------------------------------------------------------------------------
// Şifre karma biçimi ve sabit zamanlı karşılaştırma
// ---------------------------------------------------------------------------

export const PASSWORD_ITERATIONS = 210000
export const PASSWORD_SALT_BYTES = 16
export const PASSWORD_KEY_BYTES = 32

/** `pbkdf2$210000$<saltHex>$<hashHex>` biçimini doğrular. */
export function verifyPasswordHashFormat(hash: unknown): boolean {
  return (
    typeof hash === 'string' &&
    /^pbkdf2\$210000\$[0-9a-f]{32}\$[0-9a-f]{64}$/i.test(hash)
  )
}

export function parsePasswordHash(hash: unknown): { salt: Uint8Array; hash: Uint8Array } | null {
  if (!verifyPasswordHashFormat(hash)) return null
  const parts = (hash as string).split('$')
  const salt = hexToBytes(parts[2])
  const expected = hexToBytes(parts[3])
  if (salt.length !== PASSWORD_SALT_BYTES || expected.length !== PASSWORD_KEY_BYTES) return null
  return { salt, hash: expected }
}

/** Uzunluk ve onaltılık biçim kontrolü yapan sabit zamanlı karşılaştırma. */
export function timingSafeEqualHex(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (a.length === 0 || a.length !== b.length || a.length % 2 !== 0) return false
  if (!/^[0-9a-fA-F]+$/.test(a) || !/^[0-9a-fA-F]+$/.test(b)) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 2) {
    diff |=
      Number.parseInt(a.slice(i, i + 2), 16) ^ Number.parseInt(b.slice(i, i + 2), 16)
  }
  return diff === 0
}

/** IP ve tuzdan deterministik, tek yönlü anahtar üretir. */
export function hashIp(ip: string, salt: string): string {
  return sha256Hex(`${salt}:${ip}`)
}

// ---------------------------------------------------------------------------
// Doğrulama yardımcıları (validation.ts ile aynı kurallar)
// ---------------------------------------------------------------------------

export const QUESTION_TYPES = [
  'short_text',
  'long_text',
  'number',
  'single_choice',
  'multiple_choice',
  'yes_no',
  'checkbox',
] as const

export type QuestionType = (typeof QUESTION_TYPES)[number]

export function isValidQuestionType(value: unknown): value is QuestionType {
  return typeof value === 'string' && (QUESTION_TYPES as readonly string[]).includes(value)
}

export const SCORE_CRITERIA = [
  { key: 'communication', label: 'İletişim', weight: 20 },
  { key: 'knowledge', label: 'Bilgi seviyesi', weight: 20 },
  { key: 'responsibility', label: 'Sorumluluk', weight: 15 },
  { key: 'problem_solving', label: 'Problem çözme', weight: 15 },
  { key: 'experience', label: 'Deneyim', weight: 15 },
  { key: 'position_fit', label: 'Pozisyona uygunluk', weight: 15 },
] as const

export type ScoreCriterionKey = (typeof SCORE_CRITERIA)[number]['key']

export function isValidScoreCriterion(key: unknown): key is ScoreCriterionKey {
  return typeof key === 'string' && SCORE_CRITERIA.some((item) => item.key === key)
}

export interface ScoreValidationResult {
  valid: boolean
  total: number
  error?: string
}

/**
 * Puanları kriter ağırlıklarına ve 100 toplam sınırına göre doğrular.
 * `weights` veritabanından gelen ağırlıklarla varsayılanları geçersiz kılabilir.
 */
export function validateScorePayload(
  scores: Record<string, unknown> | null | undefined,
  weights: Record<string, number> = {},
): ScoreValidationResult {
  if (!scores || typeof scores !== 'object' || Array.isArray(scores)) {
    return { valid: false, total: 0, error: 'Puan verisi geçersiz.' }
  }
  let total = 0
  for (const [key, value] of Object.entries(scores)) {
    if (!isValidScoreCriterion(key)) {
      return { valid: false, total, error: `Bilinmeyen puan kriteri: ${key}.` }
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return { valid: false, total, error: 'Puanlar sıfırdan küçük olmayan sayılar olmalıdır.' }
    }
    const criterion = SCORE_CRITERIA.find((item) => item.key === key)!
    const weight = Number.isFinite(weights[key]) ? weights[key] : criterion.weight
    if (value > weight) {
      return {
        valid: false,
        total,
        error: `${criterion.label} puanı en fazla ${weight} olabilir.`,
      }
    }
    total += value
  }
  if (total > 100) return { valid: false, total, error: 'Toplam puan 100’ü aşamaz.' }
  return { valid: true, total }
}

export function isValidMinecraftUsername(value: unknown): boolean {
  return typeof value === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(value)
}

export function isValidDiscordUsername(value: unknown): boolean {
  return typeof value === 'string' && /^[a-zA-Z0-9._]{2,32}$/.test(value)
}

/** Başvuru yaşı 16–99 (canonical aralık; şema, tohum ve UI ile aynı). */
export function isValidAge(value: unknown): boolean {
  const age = typeof value === 'string' ? Number(value) : value
  return typeof age === 'number' && Number.isFinite(age) && Number.isInteger(age) && age >= 16 && age <= 99
}

// İlk yönetici kurulumu için katı kimlik bilgisi kuralları; CLI ile birebir aynıdır.
export const SETUP_USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,32}$/
export const MIN_SETUP_PASSWORD_LENGTH = 12
export const MAX_SETUP_PASSWORD_LENGTH = 500

export function isValidSetupUsername(value: unknown): boolean {
  return typeof value === 'string' && SETUP_USERNAME_PATTERN.test(value)
}

export function isValidSetupPassword(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.length >= MIN_SETUP_PASSWORD_LENGTH &&
    value.length <= MAX_SETUP_PASSWORD_LENGTH
  )
}

export function isValidHours(value: unknown): boolean {
  const hours = typeof value === 'string' ? Number(value) : value
  return typeof hours === 'number' && Number.isFinite(hours) && hours >= 0 && hours <= 24
}

/** Honeypot ve minimum dolum süresi kontrolü. */
export function isHumanSubmission(website: unknown, elapsedMs: unknown): boolean {
  const honeypotEmpty = website === undefined || website === null || website === ''
  const elapsed = typeof elapsedMs === 'string' ? Number(elapsedMs) : elapsedMs
  return honeypotEmpty && typeof elapsed === 'number' && Number.isFinite(elapsed) && elapsed >= 3000
}

export const TRACKING_NO_PATTERN = /^LSC-\d{4}-[A-Z2-9]{6}$/

export function isValidTrackingNo(value: unknown): boolean {
  return typeof value === 'string' && TRACKING_NO_PATTERN.test(value)
}

const TRACKING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Rastgele baytlardan `LSC-YYYY-XXXXXX` biçiminde takip numarası üretir. */
export function createTrackingNo(year: number, randomBytes: Uint8Array): string {
  let suffix = ''
  for (let i = 0; i < 6; i += 1) {
    suffix += TRACKING_ALPHABET[randomBytes[i % randomBytes.length] % TRACKING_ALPHABET.length]
  }
  return `LSC-${year}-${suffix}`
}

// ---------------------------------------------------------------------------
// CORS ve yönlendirme güvenliği
// ---------------------------------------------------------------------------

export const DEFAULT_ALLOWED_ORIGIN = 'http://localhost:5173'

/** `ALLOWED_ORIGINS` listesini normalize eder; boşsa yerel geliştirme adresi. */
export function getAllowedOrigins(raw?: string | null): string[] {
  const configured = raw ?? env('ALLOWED_ORIGINS') ?? DEFAULT_ALLOWED_ORIGIN
  return configured
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter(Boolean)
}

/** Kimlik bilgisiyle çalışan CORS için origin yansıtma kuralı. Joker kullanılmaz. */
export function isAllowedOrigin(
  origin: string | null | undefined,
  allowed?: string | string[] | null,
): boolean {
  if (!origin || typeof origin !== 'string') return false
  const list = Array.isArray(allowed) ? allowed : getAllowedOrigins(allowed)
  const candidate = origin.trim().replace(/\/+$/, '')
  if (!candidate || candidate === '*') return false
  return list.some((item) => {
    const normalized = item.trim().replace(/\/+$/, '')
    if (!normalized || normalized === '*') return false
    if (normalized === candidate) return true
    try {
      return new URL(normalized).origin === new URL(candidate).origin
    } catch {
      return false
    }
  })
}

// ---------------------------------------------------------------------------
// Denetim günlüğü ve bildirim kuyruğu sözleşmesi (0001 şeması)
// ---------------------------------------------------------------------------

/**
 * audit_logs satırını şemadaki sütun adlarıyla üretir.
 * entity_* / admin_id gibi eski alanlar şemada bulunmaz; actor_type zorunludur.
 */
export function buildAuditRow(
  adminId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  details: Record<string, unknown> = {},
): {
  actor_type: 'admin' | 'system'
  actor_id: string | null
  action: string
  target_table: string
  target_id: string | null
  details: Record<string, unknown>
} {
  return {
    actor_type: adminId ? 'admin' : 'system',
    actor_id: adminId,
    action,
    target_table: entityType,
    target_id: entityId,
    details,
  }
}

/** Yeniden gönder yalnızca başarısız bildirimler için geçerlidir. */
export function canRetryNotification(status: unknown): boolean {
  return status === 'failed'
}

/** Günlük aktivite seçeneğini şemadaki sayısal daily_hours aralığına eşler. */
export function dailyActivityToHours(value: unknown): number {
  const map: Record<string, number> = {
    her_gun: 6,
    haftada_birkaç: 3,
    haftada_bir: 1,
    nadir: 0.5,
  }
  if (typeof value === 'number' && Number.isFinite(value)) return Math.min(24, Math.max(0, value))
  if (typeof value === 'string') {
    if (map[value] !== undefined) return map[value]
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return Math.min(24, Math.max(0, numeric))
  }
  return 0
}

/** Discord OAuth geri dönüş adresi yalnızca yapılandırılmış originlere izin verir. */
export function isSafeReturnTo(value: unknown, allowed: string[] = getAllowedOrigins()): boolean {
  if (typeof value !== 'string' || !value || value.startsWith('//')) return false
  try {
    const base = allowed.find((item) => {
      try {
        return Boolean(new URL(item))
      } catch {
        return false
      }
    }) ?? DEFAULT_ALLOWED_ORIGIN
    const target = new URL(value, base)
    if (value.startsWith('/')) return target.origin === new URL(base).origin
    return allowed.some((item) => {
      try {
        return new URL(item).origin === target.origin
      } catch {
        return false
      }
    })
  } catch {
    return false
  }
}
