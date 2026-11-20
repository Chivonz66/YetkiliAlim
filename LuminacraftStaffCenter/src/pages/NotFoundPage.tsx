import { ArrowLeft, Compass } from 'lucide-react'
import { Link } from 'react-router-dom'

/** Eşleşmeyen rotalar için GitHub Pages 404 yönlendirmesinden sonra görülen sayfa. */
export function NotFoundPage() {
  return (
    <div className="pixel-grid flex min-h-screen items-center justify-center p-6">
      <main className="panel max-w-lg p-8 text-center" role="alert">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg border border-emerald-400/25 bg-emerald-400/10 text-emerald-300">
          <Compass size={26} aria-hidden="true" />
        </span>
        <p className="mt-5 font-mono text-xs tracking-[0.2em] text-cyan-300 uppercase">404 / Sayfa bulunamadı</p>
        <h1 className="mt-2 text-2xl font-bold text-white">Bu sayfayı bulamadık</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          Aradığınız adres taşınmış veya hiç var olmamış olabilir. Ana sayfadan başvuru ve durum
          sorgulama bağlantılarına ulaşabilirsiniz.
        </p>
        <Link to="/" className="btn-minecraft mt-6 inline-flex items-center gap-2">
          <ArrowLeft size={16} aria-hidden="true" />
          Ana sayfaya dön
        </Link>
      </main>
    </div>
  )
}

export default NotFoundPage
