import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Spinner } from '../../components/ui/Spinner'
import AdminLayout, { AdminToastProvider } from '../../components/admin/AdminLayout'
import { verifyAdmin } from '../../lib/api-admin'
import AdminLoginPage from './AdminLoginPage'
import AdminSetupPage from './AdminSetupPage'
import AdminDashboardPage from './AdminDashboardPage'
import ApplicationsPage from './ApplicationsPage'
import ApplicationDetailPage from './ApplicationDetailPage'
import QuestionsPage from './QuestionsPage'
import PositionsPage from './PositionsPage'
import SettingsPage from './SettingsPage'

function RequireAuth({ authenticated, children }: { authenticated: boolean; children: ReactNode }) {
  const location = useLocation()
  if (!authenticated) {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />
  }
  return <>{children}</>
}

export default function AdminApp() {
  const [checking, setChecking] = useState(true)
  const [username, setUsername] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    verifyAdmin()
      .then((result) => {
        if (!active) return
        setUsername(result.admin?.username ?? null)
      })
      .catch(() => {
        if (active) setUsername(null)
      })
      .finally(() => {
        if (active) setChecking(false)
      })
    return () => {
      active = false
    }
  }, [])

  if (checking) {
    return (
      <div
        className="pixel-grid flex min-h-screen flex-col items-center justify-center gap-4"
        role="status"
        aria-live="polite"
      >
        <Spinner size={36} />
        <p className="font-mono text-sm tracking-wide text-emerald-300">Oturunuz kontrol ediliyor...</p>
      </div>
    )
  }

  const authenticated = Boolean(username)

  return (
    <AdminToastProvider>
      <Routes>
        <Route
          path="login"
          element={
            authenticated ? (
              <Navigate to="/admin" replace />
            ) : (
              <AdminLoginPage onAuthenticated={setUsername} />
            )
          }
        />
        <Route path="setup" element={<AdminSetupPage />} />

        <Route
          element={
            <RequireAuth authenticated={authenticated}>
              <AdminLayout username={username ?? ''} onLoggedOut={() => setUsername(null)} />
            </RequireAuth>
          }
        >
          <Route index element={<AdminDashboardPage />} />
          <Route path="applications" element={<ApplicationsPage />} />
          <Route path="applications/:id" element={<ApplicationDetailPage />} />
          <Route path="questions" element={<QuestionsPage />} />
          <Route path="positions" element={<PositionsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        <Route path="*" element={<Navigate to={authenticated ? '/admin' : '/admin/login'} replace />} />
      </Routes>
    </AdminToastProvider>
  )
}
