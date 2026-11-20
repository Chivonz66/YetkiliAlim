import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Yalnızca kaynak metni okur; ağ, Supabase veya tarayıcı gerekmez.
function projeKokunuBul(): string {
  let dizin = process.cwd()
  for (let adim = 0; adim < 5; adim += 1) {
    if (existsSync(join(dizin, 'src/pages/admin/AdminSetupPage.tsx'))) return dizin
    const ust = join(dizin, '..')
    if (ust === dizin) break
    dizin = ust
  }
  throw new Error('Luminacraft Staff Center proje kökü bulunamadı.')
}

const kok = projeKokunuBul()
const sayfa = readFileSync(join(kok, 'src/pages/admin/AdminSetupPage.tsx'), 'utf8')
const vite = readFileSync(join(kok, 'vite.config.ts'), 'utf8')

describe('Kurulum dokümanı bağlantısı', () => {
  it('doküman bağlantısı base path kullanır', () => {
    expect(sayfa).toContain("import { withBasePath } from '../../lib/constants'")
    expect(sayfa).toContain("href={withBasePath('/docs/kurulum.md')}")
    expect(sayfa).not.toContain('href="/docs/kurulum.md"')
  })

  it('doküman derleme çıktısına kopyalanır', () => {
    expect(vite).toContain("copyFileSync(join(process.cwd(), 'docs', 'kurulum.md')")
    expect(vite).toContain("plugins: [react(), copyDocs()]")
  })
})
