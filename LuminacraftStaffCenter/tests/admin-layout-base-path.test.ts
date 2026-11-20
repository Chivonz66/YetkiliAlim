import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Yalnızca kaynak metni okur; ağ, Supabase veya tarayıcı gerekmez.
function projeKokunuBul(): string {
  let dizin = process.cwd()
  for (let adim = 0; adim < 5; adim += 1) {
    if (existsSync(join(dizin, 'src/components/admin/AdminLayout.tsx'))) return dizin
    const ust = join(dizin, '..')
    if (ust === dizin) break
    dizin = ust
  }
  throw new Error('Luminacraft Staff Center proje kökü bulunamadı.')
}

const kaynak = readFileSync(
  join(projeKokunuBul(), 'src/components/admin/AdminLayout.tsx'),
  'utf8',
)

describe('Yönetim düzeni alt yol bağlantıları', () => {
  it('Siteye dön bağlantısı sabit kök yerine base path kullanır', () => {
    expect(kaynak).toContain("import { withBasePath } from '../../lib/constants'")
    expect(kaynak).toContain('href={withBasePath(\'/\')}')
    expect(kaynak).not.toContain('href="/"')
  })
})
