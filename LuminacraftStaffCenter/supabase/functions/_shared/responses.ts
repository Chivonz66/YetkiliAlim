// Ortak HTTP yanıtları. Yığın izi veya iç sunucu ayrıntısı asla döndürülmez.

const DEFAULT_MESSAGES: Record<number, string> = {
  400: 'İstek geçersiz.',
  401: 'Oturum açmanız gerekiyor.',
  403: 'Bu işlem için yetkiniz yok.',
  404: 'Kayıt bulunamadı.',
  405: 'Bu yöntem desteklenmiyor.',
  409: 'İşlem çakışması oluştu.',
  429: 'Çok fazla istek gönderdiniz. Lütfen daha sonra tekrar deneyin.',
  500: 'Sunucuda bir hata oluştu.',
  503: 'Servis şu anda yapılandırılmamış.',
}

export function json(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  })
}

export function error(message: string, status: number, code?: string): Response {
  const safeMessage =
    typeof message === 'string' && message.length > 0 ? message : DEFAULT_MESSAGES[status] ?? DEFAULT_MESSAGES[500]
  return json(
    {
      ok: false,
      error: safeMessage,
      ...(code ? { code } : {}),
    },
    status,
  )
}

export function defaultMessage(status: number): string {
  return DEFAULT_MESSAGES[status] ?? DEFAULT_MESSAGES[500]
}
