import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Yalnızca anonim (public) anahtar kullanılır. service_role asla istemciye eklenmez.
const supabaseUrl: string = import.meta.env.VITE_SUPABASE_URL ?? ''
const supabaseAnonKey: string = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

export interface SupabaseConfig {
  url: string
  anonKey: string
  isConfigured: boolean
}

export function getSupabaseConfig(): SupabaseConfig {
  return {
    url: supabaseUrl,
    anonKey: supabaseAnonKey,
    isConfigured: Boolean(supabaseUrl && supabaseAnonKey),
  }
}

// Yapılandırma eksik olsa bile import sırasında hata fırlatılmaması için yerel
// tutucu değerler kullanılır; gerçek istekler öncesinde .env kontrolü yapılmalıdır.
export const supabase: SupabaseClient = createClient(
  supabaseUrl || 'http://localhost:54321',
  supabaseAnonKey || 'public-anon-key-placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
)

/** Supabase Edge Functions tam URL'sini döndürür. */
export function FUNCTIONS_URL(path: string): string {
  const base = getSupabaseConfig().url.replace(/\/+$/, '')
  const normalized = path.startsWith('/') ? path : `/${path}`
  const functionPath = normalized.startsWith('/functions/v1/')
    ? normalized
    : `/functions/v1${normalized}`
  return `${base}${functionPath}`
}
