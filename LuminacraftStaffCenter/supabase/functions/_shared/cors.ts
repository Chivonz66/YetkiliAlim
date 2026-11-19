// CORS: yalnızca yapılandırılmış originler yansıtılır; kimlik bilgileriyle joker origin kullanılmaz.
import { getAllowedOrigins, isAllowedOrigin } from './pure.ts'

export const ALLOWED_METHODS = 'GET,POST,PATCH,DELETE,OPTIONS'
export const ALLOWED_HEADERS =
  'authorization,apikey,content-type,x-csrf-token,x-requested-with'

export function corsHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    Vary: 'Origin',
  }
  const origin = req.headers?.get?.('origin')
  if (isAllowedOrigin(origin, getAllowedOrigins())) {
    headers['Access-Control-Allow-Origin'] = (origin as string).trim()
  }
  return headers
}

/** OPTIONS isteklerini 204 ile karşılar; diğer istekler için null döner. */
export function preflight(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null
  return new Response(null, { status: 204, headers: corsHeaders(req) })
}

/** Var olan yanıta CORS başlıklarını ekler (gövde korunur). */
export function withCors(req: Request, response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(corsHeaders(req))) headers.set(key, value)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
