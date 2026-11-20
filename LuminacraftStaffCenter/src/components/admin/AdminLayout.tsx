import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  BriefcaseBusiness,
  CheckCircle2,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { listApplications, logoutAdmin } from '../../lib/api-admin'
import { withBasePath } from '../../lib/constants'
import { cn } from '../../lib/utils'

export type ToastKind = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  message: string
  kind: ToastKind
}

interface ToastContextValue {
  notify: (message: string, kind?: ToastKind) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

function ToastIcon({ kind }: { kind: ToastKind }) {
  if (kind === 'success') return <CheckCircle2 size={18} className="shrink-0 text-emerald-300" />
  if (kind === 'error') return <AlertCircle size={18} className="shrink-0 text-red-300" />
  return <ShieldCheck size={18} className="shrink-0 text-cyan-300" />
}

function AdminToaster({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[]
  onDismiss: (id: number) => void
}) {
  if (toasts.length === 0) return null
  return (
    <div
      className="pointer-events-none fixed right-3 top-3 z-[60] flex w-[calc(100%-1.5rem)] max-w-sm flex-col gap-2 sm:right-6 sm:top-6"
      aria-live="polite"
      role="status"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'panel pointer-events-auto flex animate-fade-up items-start gap-3 px-4 py-3 text-sm shadow-2xl',
            toast.kind === 'error' ? 'border-red-400/40' : 'border-emerald-400/30',
          )}
        >
          <ToastIcon kind={toast.kind} />
          <span className="flex-1 leading-relaxed text-slate-100">{toast.message}</span>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label="Bildirimi kapat"
            className="rounded p-0.5 text-slate-500 transition-colors hover:text-white"
          >
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  )
}

export function AdminToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const notify = useCallback(
    (message: string, kind: ToastKind = 'success') => {
      const id = Date.now() + Math.random()
      setToasts((current) => [...current.slice(-3), { id, message, kind }])
      window.setTimeout(() => dismiss(id), 5000)
    },
    [dismiss],
  )

  const value = useMemo(() => ({ notify }), [notify])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <AdminToaster toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

/** Bildirim göstermek için kullanılır; provider yoksa sessizce yoksayılır. */
export function useAdminToast(): (message: string, kind?: ToastKind) => void {
  return useContext(ToastContext)?.notify ?? (() => undefined)
}

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

const NAV_ITEMS: NavItem[] = [
  { to: '/admin', label: 'Panelim', icon: LayoutDashboard },
  { to: '/admin/applications', label: 'Başvurular', icon: FileText },
  { to: '/admin/questions', label: 'Sorular', icon: ShieldCheck },
  { to: '/admin/positions', label: 'Pozisyonlar', icon: BriefcaseBusiness },
  { to: '/admin/settings', label: 'Ayarlar', icon: Settings },
]

export interface AdminLayoutProps {
  username: string
  onLoggedOut: () => void
}

export default function AdminLayout({ username, onLoggedOut }: AdminLayoutProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [pendingCount, setPendingCount] = useState<number | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const notify = useAdminToast()

  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  useEffect(() => {
    let active = true
    listApplications({ status: 'pending', limit: 1 })
      .then((result) => {
        if (active) setPendingCount(result.total)
      })
      .catch(() => {
        // Rozet isteğe bağlıdır; hata durumunda panel kullanılabilir kalır.
      })
    return () => {
      active = false
    }
  }, [location.pathname])

  const handleLogout = async () => {
    setLoggingOut(true)
    try {
      await logoutAdmin()
      notify('Oturumunuz kapatıldı.', 'success')
      onLoggedOut()
      navigate('/admin/login', { replace: true })
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Çıkış yapılamadı.', 'error')
    } finally {
      setLoggingOut(false)
    }
  }

  const sidebar = (
    <div className="flex h-full flex-col gap-6 px-4 py-5">
      <div className="flex items-center gap-3 px-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-400/30 bg-emerald-400/10 text-lg font-black text-emerald-300">
          L
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold tracking-wide text-white">LUMINACRAFT</p>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-300/80">
            Staff Center
          </p>
        </div>
      </div>

      <nav className="flex flex-col gap-1" aria-label="Yönetici menüsü">
        <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
          Yönetim
        </p>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/admin'}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
                    : 'border-transparent text-slate-400 hover:bg-white/5 hover:text-white',
                )
              }
            >
              <Icon size={18} className="shrink-0" />
              <span className="flex-1">{item.label}</span>
              {item.to === '/admin/applications' && pendingCount !== null && pendingCount > 0 && (
                <Badge variant="warning" className="px-2 py-0 text-[10px]">
                  {pendingCount}
                </Badge>
              )}
            </NavLink>
          )
        })}
      </nav>

      <div className="mt-auto space-y-3">
        <a
          href={withBasePath('/')}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
        >
          <ArrowLeft size={16} /> Siteye dön
        </a>
        <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-3">
          <p className="text-[11px] uppercase tracking-widest text-slate-500">Oturum</p>
          <p className="mt-1 truncate text-sm font-semibold text-slate-100">{username || 'Yönetici'}</p>
          <Button
            variant="ghost"
            fullWidth
            className="mt-2 justify-start px-0 text-red-300 hover:text-red-200"
            icon={<LogOut size={16} />}
            loading={loggingOut}
            onClick={handleLogout}
          >
            Güvenli çıkış
          </Button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="pixel-grid flex min-h-screen">
      {drawerOpen && (
        <button
          type="button"
          aria-label="Menüyü kapat"
          className="fixed inset-0 z-30 bg-black/70 backdrop-blur-sm lg:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}
      <aside className="hidden w-64 shrink-0 border-r border-white/5 bg-obsidian-900/60 lg:sticky lg:top-0 lg:block lg:h-screen">
        {sidebar}
      </aside>
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-64 border-r border-white/10 bg-obsidian-900 transition-transform duration-200 lg:hidden',
          drawerOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-hidden={!drawerOpen}
      >
        <button
          type="button"
          onClick={() => setDrawerOpen(false)}
          aria-label="Menüyü kapat"
          className="absolute right-3 top-4 rounded-md p-1.5 text-slate-400 hover:bg-white/5 hover:text-white lg:hidden"
        >
          <X size={18} />
        </button>
        {sidebar}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/5 bg-obsidian-900/80 px-4 py-3 backdrop-blur sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Menüyü aç"
            className="rounded-md border border-white/10 bg-white/5 p-2 text-slate-300 lg:hidden"
          >
            <Menu size={20} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-widest text-slate-500">Yönetim paneli</p>
            <p className="truncate text-sm font-semibold text-slate-100">
              Merhaba, {username || 'Yönetici'} 👋
            </p>
          </div>
          <Badge variant="success" className="hidden sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Oturum açık
          </Badge>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
