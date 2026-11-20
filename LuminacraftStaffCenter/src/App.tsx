import {
  Component,
  Suspense,
  lazy,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Spinner } from './components/ui/Spinner'
import { BASE_PATH } from './lib/constants'

const HomePage = lazy(() => import('./pages/HomePage'))
const ApplyPage = lazy(() => import('./pages/ApplyPage'))
const StatusPage = lazy(() => import('./pages/StatusPage'))
const AdminApp = lazy(() => import('./pages/admin/AdminApp'))

interface ErrorBoundaryState {
  hasError: boolean
  message: string
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: '' }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error?.message ?? '' }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Uygulama hatası:', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main className="pixel-grid flex min-h-screen items-center justify-center p-6">
          <div className="panel max-w-lg p-8 text-center" role="alert">
            <h1 className="text-2xl font-bold text-white">Bir şeyler ters gitti</h1>
            <p className="mt-3 text-sm text-slate-400">
              Sayfa yüklenirken beklenmeyen bir hata oluştu. Lütfen sayfayı yenileyip tekrar deneyin.
            </p>
            <button
              type="button"
              className="btn-minecraft mt-6"
              onClick={() => window.location.reload()}
            >
              Sayfayı yenile
            </button>
          </div>
        </main>
      )
    }
    return this.props.children
  }
}

function LoadingFallback() {
  return (
    <div
      className="pixel-grid flex min-h-screen flex-col items-center justify-center gap-4"
      role="status"
      aria-live="polite"
    >
      <Spinner size={36} />
      <p className="font-mono text-sm tracking-wide text-emerald-300">Sayfa yükleniyor...</p>
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter basename={BASE_PATH || '/'}>
        <Suspense fallback={<LoadingFallback />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/apply/:position" element={<ApplyPage />} />
            <Route path="/status" element={<StatusPage />} />
            <Route path="/admin" element={<AdminApp />} />
            <Route path="/admin/*" element={<AdminApp />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
