import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Yalnızca dosya metni okur: ağ, Supabase, Deno veya canlı dağıtım gerekmez.
// npm test, LuminacraftStaffCenter dizininde çalıştırılır; depo kökü bir üsttedir.
function depoKokunuBul(): string {
  let dizin = process.cwd()
  for (let adim = 0; adim < 6; adim += 1) {
    if (
      existsSync(join(dizin, 'LuminacraftStaffCenter', 'package.json')) &&
      existsSync(join(dizin, '.github', 'workflows'))
    ) {
      return dizin
    }
    const ust = join(dizin, '..')
    if (ust === dizin) break
    dizin = ust
  }
  throw new Error('Depo kökü (.github + LuminacraftStaffCenter/package.json) bulunamadı.')
}

const KOK = depoKokunuBul()
const LSC = join(KOK, 'LuminacraftStaffCenter')
const IS_AKISI = join(KOK, '.github/workflows/deploy-luminacraft-staff-center.yml')

const oku = (dosya: string): string => readFileSync(dosya, 'utf8')
const isAkisi = (): string => oku(IS_AKISI)
const doc = (ad: string): string => oku(join(LSC, 'docs', ad))

const GEREKLI_DOSYALAR: ReadonlyArray<string> = [
  '.github/workflows/deploy-luminacraft-staff-center.yml',
  'LuminacraftStaffCenter/public/404.html',
  'LuminacraftStaffCenter/README.md',
  'LuminacraftStaffCenter/docs/kurulum.md',
  'LuminacraftStaffCenter/docs/github-pages.md',
  'LuminacraftStaffCenter/docs/discord-oauth.md',
  'LuminacraftStaffCenter/docs/edge-functions.md',
  'LuminacraftStaffCenter/docs/guvenlik.md',
  'LuminacraftStaffCenter/tests/docs-check.test.ts',
  'LuminacraftStaffCenter/index.html',
  'LuminacraftStaffCenter/package.json',
  'LuminacraftStaffCenter/vite.config.ts',
  'LuminacraftStaffCenter/.env.example',
  'LuminacraftStaffCenter/scripts/create-first-admin.mjs',
  'LuminacraftStaffCenter/supabase/migrations/0001_initial_schema.sql',
  'LuminacraftStaffCenter/supabase/migrations/0002_rls_policies.sql',
  'LuminacraftStaffCenter/supabase/migrations/0003_functions_triggers.sql',
  'LuminacraftStaffCenter/supabase/migrations/0004_seed_data.sql',
]

const DOKUMANLAR = [
  'LuminacraftStaffCenter/README.md',
  'LuminacraftStaffCenter/docs/kurulum.md',
  'LuminacraftStaffCenter/docs/github-pages.md',
  'LuminacraftStaffCenter/docs/discord-oauth.md',
  'LuminacraftStaffCenter/docs/edge-functions.md',
  'LuminacraftStaffCenter/docs/guvenlik.md',
] as const

const UC_LAR = [
  'admin-auth',
  'admin-applications',
  'admin-questions',
  'admin-positions',
  'admin-scores',
  'admin-settings',
  'public-status',
  'submit-application',
  'discord-oauth',
  'discord-notify',
] as const

/** JWT benzeri, 50+ karakterli hex veya özel anahtar satırı arar. */
function siraIzleri(metin: string): string[] {
  const kalıplar = [
    /eyJ[A-Za-z0-9_-]{10,}/g,
    /\b[0-9a-fA-F]{50,}\b/g,
    /sb_secret_[A-Za-z0-9_-]{10,}/g,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
    /https:\/\/[a-z0-9]{20,}\.supabase\.co/g,
  ]
  return kalıplar.flatMap((kalip) => metin.match(kalip) ?? [])
}

describe('doküman ve dağıtım dosyaları', () => {
  it('tüm zorunlu dosyalar mevcut ve boş değil', () => {
    for (const goreli of GEREKLI_DOSYALAR) {
      const tamYol = join(KOK, goreli)
      expect(existsSync(tamYol), `${goreli} bulunmalı`).toBe(true)
      expect(oku(tamYol).trim().length, `${goreli} boş olmamalı`).toBeGreaterThan(20)
    }
  })

  it('iş akışı adı, dal filtresi, paths ve workflow_dispatch tanımlı', () => {
    const wf = isAkisi()
    expect(wf).toContain('name:')
    expect(wf).toContain('master')
    expect(wf).toContain('paths:')
    expect(wf).toContain("'LuminacraftStaffCenter/**'")
    expect(wf).toContain("'.github/workflows/deploy-luminacraft-staff-center.yml'")
    expect(wf).toContain('workflow_dispatch:')
  })

  it('iş akışı izinleri ve eşzamanlılık ayarı doğru', () => {
    const wf = isAkisi()
    expect(wf).toContain('contents: read')
    expect(wf).toContain('pages: write')
    expect(wf).toContain('id-token: write')
    expect(wf).toContain('concurrency:')
    expect(wf).toContain('group: pages')
    expect(wf).toContain('cancel-in-progress: false')
  })

  it('build job Node 20, npm önbelleği ve npm komutlarını içeriyor', () => {
    const wf = isAkisi()
    expect(wf).toContain('actions/checkout@v4')
    expect(wf).toContain('actions/setup-node@v4')
    expect(wf).toContain("node-version: '20'")
    expect(wf).toContain("cache: 'npm'")
    expect(wf).toContain("cache-dependency-path: 'LuminacraftStaffCenter/package-lock.json'")
    expect(wf).toContain('working-directory: LuminacraftStaffCenter')
    expect(wf).toContain('run: npm ci')
    expect(wf).toContain('run: npm test')
    expect(wf).toContain('run: npm run build')
  })

  it('VITE_BASE_PATH, Pages yapılandırması ve artefakt yolu var', () => {
    const wf = isAkisi()
    expect(wf).toContain('VITE_BASE_PATH: /${{ github.event.repository.name }}/')
    expect(wf).toContain('actions/configure-pages@v5')
    expect(wf).toContain('actions/upload-pages-artifact@v3')
    expect(wf).toContain('path: LuminacraftStaffCenter/dist')
  })

  it('deploy job doğru bağımlılık, environment ve action kullanıyor', () => {
    const wf = isAkisi()
    expect(wf).toContain('needs: build')
    expect(wf).toContain('name: github-pages')
    expect(wf).toContain('url: ${{ steps.deployment.outputs.page_url }}')
    expect(wf).toContain('id: deployment')
    expect(wf).toContain('actions/deploy-pages@v4')
  })

  it('404.html yedek kopyalama adımı mevcut', () => {
    const wf = isAkisi()
    expect(wf).toContain('node -e')
    expect(wf).toContain("copyFileSync('dist/index.html','dist/404.html')")
    expect(wf).toContain('dist/404.html')
  })

  it('iş akışı gizli anahtar veya gerçek kimlik bilgisi içermiyor', () => {
    const wf = isAkisi()
    expect(wf).not.toContain('secrets.')
    expect(wf).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(wf).not.toContain('DISCORD_BOT_TOKEN')
    expect(wf).not.toContain('SESSION_SECRET')
    expect(wf).not.toMatch(/password\s*:/i)
    expect(siraIzleri(wf)).toEqual([])
  })

  it('404.html SPA kodlama dizeleri index.html ile birebir aynı', () => {
    const index = oku(join(LSC, 'index.html'))
    const fourOhFour = oku(join(LSC, 'public/404.html'))
    const ortakDizeler = [
      'encodeURIComponent(path)',
      "'?/'",
      '"/?/kodlanmis-yol"',
      "search.indexOf('?/') === 0",
      'decodeURIComponent(search.slice(1))',
      "window.history.replaceState(null, '', path + window.location.hash)",
    ]
    for (const dize of ortakDizeler) {
      expect(index, `index.html içinde ${dize} olmalı`).toContain(dize)
      expect(fourOhFour, `404.html içinde ${dize} olmalı`).toContain(dize)
    }
    expect(fourOhFour).toContain('window.location.replace(')
    expect(fourOhFour).toContain('taban + \'?/\' + encodeURIComponent(path)')
  })

  it('README projeyi, mimariyi, belgeleri ve dış gereksinimleri anlatıyor', () => {
    const readme = oku(join(LSC, 'README.md'))
    for (const anahtar of [
      'Supabase',
      'Discord',
      'GitHub Pages',
      'Edge Functions',
      'ilk yönetici',
      'RLS',
      'Mimarî',
      'Özellikler',
      'Teknoloji yığını',
      'Hızlı başlangıç',
      'Ortam değişkenleri',
      'Bilinen sınırlamalar',
      'örnek/mock veri içermez',
    ]) {
      expect(readme).toContain(anahtar)
    }
    for (const baglanti of [
      'docs/kurulum.md',
      'docs/github-pages.md',
      'docs/discord-oauth.md',
      'docs/edge-functions.md',
      'docs/guvenlik.md',
    ]) {
      expect(readme).toContain(baglanti)
    }
  })

  it('kurulum.md t kurulum adımlarını ve göç sırasını içeriyor', () => {
    const kurulum = doc('kurulum.md')
    for (const anahtar of [
      'Supabase projesi oluşturma',
      '0001_initial_schema.sql',
      '0002_rls_policies.sql',
      '0003_functions_triggers.sql',
      '0004_seed_data.sql',
      '.env.example',
      'VITE_SUPABASE_ANON_KEY',
      'create-first-admin.mjs',
      'supabase secrets set',
      'supabase functions deploy',
      'npm ci',
      'npm run dev',
      'Doğrulama kontrol listesi',
      'Sorun giderme',
      'service_role',
    ]) {
      expect(kurulum).toContain(anahtar)
    }
  })

  it('github-pages.md Pages ayarı, taban yol ve hata durumlarını kapsıyor', () => {
    const rehber = doc('github-pages.md')
    for (const anahtar of [
      'GitHub Actions',
      'Source',
      'VITE_BASE_PATH',
      '404.html',
      'Custom domain',
      'git push',
      'package-lock.json',
      'npm test',
      'Deploy from a branch',
      'github.io',
    ]) {
      expect(rehber).toContain(anahtar)
    }
  })

  it('discord-oauth.md callback, bot ve DM hatalarını anlatıyor', () => {
    const discord = doc('discord-oauth.md')
    for (const anahtar of [
      'discord-oauth?action=callback',
      'DISCORD_CLIENT_ID',
      'DISCORD_CLIENT_SECRET',
      'DISCORD_REDIRECT_URI',
      'DISCORD_BOT_TOKEN',
      'identify',
      'state',
      'Yeniden Dene',
      'DM',
    ]) {
      expect(discord).toContain(anahtar)
    }
    expect(discord).toMatch(/privileged gateway intents/i)
    expect(discord).toMatch(/gerekmez/i)
  })

  it('edge-functions.md 10 uç ve ortak güvenlik başlıklarını içeriyor', () => {
    const edge = doc('edge-functions.md')
    for (const uc of UC_LAR) expect(edge, `${uc} anlatılmalı`).toContain(uc)
    for (const anahtar of [
      'CSRF',
      'x-csrf-token',
      'SESSION_SECRET',
      'service_role',
      'supabase functions deploy',
      '--no-verify-jwt',
      'Logs',
      'curl',
    ]) {
      expect(edge).toContain(anahtar)
    }
  })

  it('guvenlik.md açıklanan güvenlik kontrollerini içeriyor', () => {
    const guvenlik = doc('guvenlik.md')
    for (const anahtar of [
      'RLS',
      'service_role',
      'PBKDF2',
      '210000',
      'HttpOnly',
      'SameSite=None',
      'Secure',
      'CSRF',
      'honeypot',
      '3000',
      'audit_logs',
      'notları',
      'SHA-256',
      'döndürme',
      'Depoda BULUNMAYAN',
    ]) {
      expect(guvenlik).toContain(anahtar)
    }
  })

  it('dokümanlar Türkçe ve yeterince ayrıntılı', () => {
    for (const goreli of DOKUMANLAR) {
      const metin = oku(join(KOK, goreli))
      expect(metin.length, `${goreli} en az 800 karakter olmalı`).toBeGreaterThan(800)
      expect(metin, `${goreli} Türkçe karakter içermeli`).toMatch(/[çğıöşüÇĞİÖŞÜ]/)
      expect(siraIzleri(metin), `${goreli} gerçek anahtar içermemeli`).toEqual([])
    }
  })

  it('.env.example yalnızca yer tutucu içeriyor', () => {
    const ornek = oku(join(LSC, '.env.example'))
    expect(ornek).toContain('VITE_SUPABASE_URL=')
    expect(ornek).toContain('VITE_SUPABASE_ANON_KEY=')
    expect(ornek).toContain('VITE_BASE_PATH=')
    expect(ornek).toContain('sizin-projeniz.supabase.co')
    expect(ornek).toContain('sizin-anon-keyiniz')
    expect(ornek).not.toContain('SERVICE_ROLE')
    expect(ornek).not.toContain('DISCORD')
    expect(siraIzleri(ornek)).toEqual([])
  })

  it('Edge uçlarının kaynak dosyaları dokümanlarla tutarlı', () => {
    for (const uc of UC_LAR) {
      const kaynak = oku(join(LSC, 'supabase/functions', uc, 'index.ts'))
      expect(kaynak).toContain('Deno.serve')
      expect(doc('edge-functions.md')).toContain(uc)
    }
  })
})
