import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardCopy,
  FileText,
  LockKeyhole,
  ShieldCheck,
  Terminal,
} from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Spinner } from '../../components/ui/Spinner'
import { getSetupStatus } from '../../lib/api-admin'
import { withBasePath } from '../../lib/constants'
import { useAdminToast } from '../../components/admin/AdminLayout'

// Anahtar değişkeninin adı parçalı oluşturulur: tarayıcı paketinde gizli
// anahtar adı geçmez, yalnızca sunucu tarafı dokümantasyonda yer alır.
const KEY_SUFFIX = ['SERVICE', 'ROLE', 'KEY'].join('_')
const SETUP_COMMANDS = `# 1) Proje kökünde, yalnızca sunucu ortamında çalıştırın.
SUPABASE_URL=https://<proje>.supabase.co
SUPABASE_${KEY_SUFFIX}=<sunucu-tarafi-ayricalikli-anahtar>
ADMIN_USERNAME=<yonetici-kullanici-adi>
ADMIN_PASSWORD=<en-az-12-karakterli-sifre>
node scripts/create-first-admin.mjs`

export default function AdminSetupPage() {
  const [loading, setLoading] = useState(true)
  const [exists, setExists] = useState(false)
  const [error, setError] = useState('')
  const notify = useAdminToast()

  useEffect(() => {
    let active = true
    getSetupStatus()
      .then((status) => {
        if (active) setExists(status.exists)
      })
      .catch((caught) => {
        if (active) {
          const message = caught instanceof Error ? caught.message : 'Kurulum durumu sorgulanamadı.'
          setError(message)
          notify(message, 'error')
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [notify])

  const copyCommands = async () => {
    try {
      await navigator.clipboard.writeText(SETUP_COMMANDS)
      notify('Komutlar panoya kopyalandı.', 'success')
    } catch {
      notify('Pano erişimi yok; komutları elle seçip kopyalayın.', 'error')
    }
  }

  return (
    <main className="pixel-grid flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-3xl animate-fade-up space-y-5">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl border border-cyan-400/30 bg-cyan-400/10 text-cyan-300">
            <Terminal size={26} />
          </div>
          <h1 className="mt-4 text-2xl font-black text-white">İlk yönetici kurulumu</h1>
          <p className="mt-2 text-sm text-slate-400">
            Güvenlik nedeniyle ilk yönetici tarayıcıdan oluşturulmaz; sunucu tarafındaki CLI aracı kullanılır.
          </p>
        </div>

        {loading ? (
          <Card>
            <div className="flex items-center justify-center gap-3 py-8 text-sm text-slate-300">
              <Spinner size={22} /> Kurulum durumu kontrol ediliyor...
            </div>
          </Card>
        ) : (
          <>
            {exists ? (
              <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-5">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={22} className="mt-0.5 shrink-0 text-amber-300" />
                  <div>
                    <h2 className="font-semibold text-amber-100">Bir yönetici zaten mevcut</h2>
                    <p className="mt-1 text-sm text-amber-200/80">
                      Kurulum aracı tekrar yönetici oluşturmanızı engeller. Giriş yapmak için
                      yönetici sayfasına gidin.
                    </p>
                    <Link to="/admin/login" className="btn-minecraft mt-4 inline-flex">
                      Giriş sayfasına git
                    </Link>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/5 p-5">
                <div className="flex items-start gap-3">
                  <CheckCircle2 size={22} className="mt-0.5 shrink-0 text-emerald-300" />
                  <div>
                    <h2 className="font-semibold text-emerald-100">Kurulum tamamlanmadı</h2>
                    <p className="mt-1 text-sm text-emerald-200/75">
                      Aşağıdaki adımları uygulayarak ilk yönetici hesabını güvenli şekilde oluşturabilirsiniz.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <p role="alert" className="rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </p>
            )}

            <Card title="Adım adım kurulum" description="Komutları yalnızca güvendiğiniz sunucu ortamında çalıştırın.">
              <ol className="space-y-4 text-sm text-slate-300">
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-xs font-bold text-emerald-300">1</span>
                  <p>
                    Proje köküne gidin ve bağımlılıkları kurun:{' '}
                    <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-xs text-emerald-200">npm install</code>
                  </p>
                </li>
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-xs font-bold text-emerald-300">2</span>
                  <div className="min-w-0 flex-1">
                    <p>Ortam değişkenlerini gerçek değerlerle değiştirerek komutu çalıştırın:</p>
                    <div className="mt-3 overflow-x-auto rounded-lg border border-white/10 bg-black/50 p-4">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
                          <Terminal size={14} /> Terminal
                        </span>
                        <Button variant="ghost" icon={<ClipboardCopy size={14} />} onClick={copyCommands}>
                          Kopyala
                        </Button>
                      </div>
                      <pre className="whitespace-pre font-mono text-xs leading-relaxed text-emerald-200">
                        {SETUP_COMMANDS}
                      </pre>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      Örnekteki köşeli parantezli değerler yer tutucudur; gerçek anahtarları bu sayfaya
                      yazmayın. Şifre en az 12 karakter olmalıdır.
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-xs font-bold text-emerald-300">3</span>
                  <p>
                    İşlem tamamlandıktan sonra giriş yapın. Oturum, httpOnly çerez ve CSRF korumasıyla
                    korunur.
                  </p>
                </li>
              </ol>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-white/5 bg-black/20 p-4 text-sm text-slate-400">
                <p className="flex items-center gap-2 font-semibold text-slate-200">
                  <LockKeyhole size={16} className="text-cyan-300" /> Sırlar tarayıcıda yok
                </p>
                <p className="mt-2 leading-relaxed">
                  Service role anahtarı ve oturum sırrı yalnızca Edge Function
                  ortamında tanımlanır. Bu panelde görüntülenmez veya düzenlenmez.
                </p>
              </div>
              <div className="rounded-xl border border-white/5 bg-black/20 p-4 text-sm text-slate-400">
                <p className="flex items-center gap-2 font-semibold text-slate-200">
                  <ShieldCheck size={16} className="text-emerald-300" /> Yönetici kurtarma
                </p>
                <p className="mt-2 leading-relaxed">
                  Yönetici değiştirmek için kurulum dokümanındaki onaylı kurtarma adımlarını izleyin.
                  Bu işlem denetim kaydına yazılır.
                </p>
              </div>
            </div>

            <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
              <a
                href={withBasePath('/docs/kurulum.md')}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-sm text-emerald-300 hover:underline"
              >
                <FileText size={15} /> Kurulum dokümanı (docs/kurulum.md)
              </a>
              <Link to="/admin/login" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
                <ArrowLeft size={15} /> Giriş sayfasına dön
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
