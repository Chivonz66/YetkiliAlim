import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// VITE_BASE_PATH örn. "/staff-center/" değeri GitHub Pages alt dizinleri için kullanılır.
// Kurulum dokümanı yönetim panelinden bağlandığı için derleme çıktısına kopyalanır.
function copyDocs() {
  let outDir = 'dist'
  return {
    name: 'lsc-copy-docs',
    configResolved(config: { build: { outDir: string } }) {
      outDir = config.build.outDir
    },
    closeBundle() {
      const hedef = join(process.cwd(), outDir, 'docs')
      mkdirSync(hedef, { recursive: true })
      copyFileSync(join(process.cwd(), 'docs', 'kurulum.md'), join(hedef, 'kurulum.md'))
    },
  }
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), copyDocs()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
  },
})
