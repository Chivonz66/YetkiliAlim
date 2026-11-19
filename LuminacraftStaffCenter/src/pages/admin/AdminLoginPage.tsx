import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Eye, EyeOff, KeyRound, LockKeyhole, ShieldAlert, UserRound } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { getSetupStatus, loginAdmin } from '../../lib/api-admin'
import { useAdminToast } from '../../components/admin/AdminLayout'

export interface AdminLoginPageProps {
  onAuthenticated: (username: string) => void
}

export default function AdminLoginPage({ onAuthenticated }: AdminLoginPageProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [setupRequired, setSetupRequired] = useState(false)
  const navigate = useNavigate()
  const notify = useAdminToast()

  useEffect(() => {
    let active = true
    getSetupStatus()
      .then((status) => {
        if (active) setSetupRequired(!status.exists)
      })
      .catch(() => {
        // Kurulum durumu isteğe bağlı bilgidir; giriş formu çalışmaya devam eder.
      })
    return () => {
      active = false
    }
  }, [])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!username.trim() || !password) {
      setError('Lütfen kullanıcı adı ve şifrenizi girin.')
      return
    }
    setLoading(true)
    try {
      const result = await loginAdmin(username.trim(), password)
      const name = result.admin?.username ?? username.trim()
      onAuthenticated(name)
      notify(`Hoş geldiniz, ${name}!`, 'success')
      navigate('/admin', { replace: true })
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Giriş yapılamadı.'
      setError(message)
      notify(message, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="pixel-grid flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md animate-fade-up space-y-5">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl border border-emerald-400/30 bg-emerald-400/10 text-2xl font-black text-emerald-300">
            L
          </div>
          <h1 className="mt-4 text-2xl font-black tracking-tight text-white">Yönetici girişi</h1>
          <p className="mt-2 text-sm text-slate-400">
            Luminacraft ekip panelinde başvuruları yönetin.
          </p>
        </div>

        <Card>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <Input
              label="Kullanıcı adı"
              autoComplete="username"
              value={username}
              placeholder="Yönetici kullanıcı adınız"
              onChange={(event) => setUsername(event.target.value)}
              suffix={<UserRound size={16} />}
            />
            <div className="relative">
              <Input
                label="Şifre"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                placeholder="Şifreniz"
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}
                className="absolute right-3 top-[34px] text-slate-500 transition-colors hover:text-white"
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>

            {error && (
              <p role="alert" className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {error}
              </p>
            )}

            <Button type="submit" fullWidth loading={loading} icon={<KeyRound size={17} />}>
              Güvenli giriş yap
            </Button>
          </form>
        </Card>

        {setupRequired && (
          <p className="rounded-lg border border-amber-400/25 bg-amber-400/5 px-4 py-3 text-sm text-amber-200">
            Henüz bir yönetici hesabı yok. Kurulum aracıyla ilk yöneticiyi oluşturmanız gerekiyor.{' '}
            <Link to="/admin/setup" className="font-semibold underline underline-offset-2">
              Kuruluma git
            </Link>
          </p>
        )}

        <div className="rounded-lg border border-white/5 bg-black/20 px-4 py-3 text-xs leading-relaxed text-slate-400">
          <p className="flex items-center gap-2 font-semibold text-slate-300">
            <ShieldAlert size={15} className="text-emerald-300" /> Güvenlik hatırlatması
          </p>
          <p className="mt-2">
            İlk yöneticiyi kurulum aracıyla oluşturun. Şifreniz güvenli bir karma olarak saklanır;
            tarayıcınıza veya günlüklere yazılmaz.
          </p>
          <Link to="/admin/setup" className="mt-2 inline-flex items-center gap-1 text-emerald-300 hover:underline">
            <LockKeyhole size={13} /> Kurulum adımlarını görüntüle
          </Link>
        </div>

        <Link
          to="/"
          className="flex items-center justify-center gap-2 text-sm text-slate-500 transition-colors hover:text-white"
        >
          <ArrowLeft size={15} /> Ana siteye dön
        </Link>
      </div>
    </main>
  )
}
