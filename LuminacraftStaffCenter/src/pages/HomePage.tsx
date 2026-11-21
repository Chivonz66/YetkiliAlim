import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Clock3,
  Compass,
  HelpCircle,
  LockKeyhole,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Trophy,
} from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import {
  areApplicationsOpen,
  getClosedMessage,
  getPositions,
  getSettings,
  isPositionOpen,
  type SettingsMap,
} from '../lib/api-public'
import { POSITIONS } from '../lib/constants'
import type { Position, PositionSlug } from '../types'

type LoadState = 'loading' | 'ready' | 'unconfigured'

const REQUIREMENTS = [
  '16–99 yaş arasında olmak,',
  'Sunucuda düzenli ve aktif zaman geçirmek,',
  'Oyunculara karşı saygılı ve sabırlı iletişim kurmak,',
  'Başvuru sorularını dürüstçe ve özenle yanıtlamak.',
]

const FAQ = [
  {
    question: 'Başvuru süreci nasıl işler?',
    answer:
      'Pozisyonunuzu seçip başvuru formunu doldurursunuz. Başvurunuz kaydedildiğinde size özel bir başvuru numarası ve sorgu kodu verilir. Ekibimiz yanıtları inceledikten sonra karar durumunu sorgulama sayfasından görebilirsiniz.',
  },
  {
    question: 'Kaç yaşında olmam gerekiyor?',
    answer:
      'Başvuru için yaş sınırı 16–99’dur. Başvuru formunda yaş bilgisi zorunludur ve gerçek bilgilerle doldurulmalıdır.',
  },
  {
    question: 'Discord kullanıcı adı neden zorunlu?',
    answer:
      'Discord kullanıcı adınız, ekibimizin sizi tanıması için zorunludur. Formda yalnızca kullanıcı adınızı yazmanız yeterlidir.',
  },
  {
    question: 'Aynı anda birden fazla pozisyona başvurabilir miyim?',
    answer:
      'Başvurular pozisyon bazında değerlendirilir. İki ekibe de uygun olduğunuzu düşünüyorsanız her pozisyon için ayrı bir başvuru oluşturabilirsiniz; ancak süreçleri birlikte yürütmeniz gerekir.',
  },
  {
    question: 'Sonuçları nasıl öğreneceğim?',
    answer:
      'Başvuru numaranız ve sorgu kodunuz ile “Başvuru durumum” sayfasından durumunuzu öğrenebilirsiniz. Sorgu kodu yalnızca size verilir; başvurunuzun gizliliği için kimseyle paylaşmayın.',
  },
  {
    question: 'Sonuçlar ne zaman açıklanır?',
    answer:
      'İnceleme süresi başvuru yoğunluğuna göre değişir. Karar verildiğinde başvuru durumunuz güncellenir; sonucu başvuru numaranız ve sorgu kodunuzla öğrenebilirsiniz.',
  },
]

function LogoMark({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width="64"
      height="64"
      shapeRendering="crispEdges"
      role="img"
      aria-label="Luminacraft L logosu"
      className={className}
    >
      <path d="M12 4h40v4h4v44h-4v4H12v-4H8V8h4z" fill="#0b1519" />
      <path d="M16 8h32v4h4v36h-4v4H16v-4h-4V12h4z" fill="none" stroke="#2c6b5c" strokeWidth="2" />
      <path d="M18 16h9v25h19v9H18z" fill="#34e0a1" />
      <path d="M27 16h6v24h13v5H27z" fill="#4fd8e8" opacity="0.72" />
      <path d="M18 16h19v4H22v21h-4z" fill="#b8ffdf" opacity="0.9" />
      <path d="M44 12h4v4h-4zM48 16h4v4h-4zM12 44h4v4h-4z" fill="#34e0a1" opacity="0.6" />
    </svg>
  )
}

const POSITION_ICONS: Record<PositionSlug, LucideIcon> = {
  rehber: Compass,
  aac: ShieldCheck,
}

function PositionCard({ position, settings }: { position: Position; settings: SettingsMap }) {
  const meta = POSITIONS.find((item) => item.slug === position.slug)
  const Icon = POSITION_ICONS[position.slug] ?? Sparkles
  const open = isPositionOpen(settings, position.slug, position)

  return (
    <article className="panel glow-border group flex h-full flex-col p-5 transition-transform duration-300 hover:-translate-y-1 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-lg border border-emerald-400/25 bg-emerald-400/10 text-emerald-300">
          <Icon size={24} aria-hidden="true" />
        </span>
        <Badge variant={open ? 'success' : 'warning'}>
          {open ? (
            <>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" aria-hidden="true" />
              Başvurular açık
            </>
          ) : (
            <>
              <LockKeyhole size={12} aria-hidden="true" />
              Şu anda kapalı
            </>
          )}
        </Badge>
      </div>

      <h3 className="mt-5 text-xl font-semibold text-white">{position.name}</h3>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-400">
        {position.description || meta?.description || 'Luminacraft ekibinde bu pozisyon hakkında detaylar yakında.'}
      </p>

      <div className="mt-6">
        {open ? (
          <Link
            to={`/apply/${position.slug}`}
            className="btn-minecraft w-full"
            aria-label={`${position.name} pozisyonuna başvur`}
          >
            Başvuruyu başlat
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        ) : (
          <Button variant="secondary" fullWidth disabled icon={<LockKeyhole size={15} />}>
            Başvurular kapalı
          </Button>
        )}
      </div>
    </article>
  )
}

function PositionSkeleton() {
  return (
    <div className="panel p-6" aria-hidden="true">
      <div className="h-12 w-12 animate-pulse rounded-lg bg-white/5" />
      <div className="mt-5 h-5 w-1/3 animate-pulse rounded bg-white/5" />
      <div className="mt-3 h-3 w-full animate-pulse rounded bg-white/5" />
      <div className="mt-2 h-3 w-4/5 animate-pulse rounded bg-white/5" />
      <div className="mt-6 h-10 w-full animate-pulse rounded bg-white/5" />
    </div>
  )
}

export function HomePage() {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [positions, setPositions] = useState<Position[]>([])
  const [settings, setSettings] = useState<SettingsMap>({})
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      const [positionsResult, settingsResult] = await Promise.allSettled([getPositions(), getSettings()])
      if (!active) return

      if (
        positionsResult.status === 'rejected' &&
        (positionsResult.reason as { code?: string } | undefined)?.code === 'NOT_CONFIGURED'
      ) {
        setLoadState('unconfigured')
        return
      }

      setPositions(positionsResult.status === 'fulfilled' ? positionsResult.value : [])
      setSettings(settingsResult.status === 'fulfilled' ? settingsResult.value : {})
      if (positionsResult.status === 'rejected' || settingsResult.status === 'rejected') {
        setLoadError('Bazı bilgiler şu anda yüklenemedi. Lütfen daha sonra tekrar deneyin.')
      }
      setLoadState('ready')
    }
    void load()
    return () => {
      active = false
    }
  }, [])

  const applicationsOpen = areApplicationsOpen(settings)

  return (
    <div className="pixel-grid min-h-screen text-slate-200">
      <header className="border-b border-white/5 bg-obsidian-950/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <LogoMark className="h-9 w-9" />
            <div className="leading-tight">
              <p className="text-sm font-bold tracking-wide text-white">LUMINACRAFT</p>
              <p className="font-mono text-[10px] tracking-[0.2em] text-emerald-350">STAFF CENTER</p>
            </div>
          </div>
          <nav className="flex items-center gap-1 sm:gap-3" aria-label="Ana menü">
            <Link to="/status" className="rounded-md px-2.5 py-2 text-xs text-slate-400 transition-colors hover:text-white sm:text-sm">
              Başvuru durumum
            </Link>
            <Link to="/admin" className="rounded-md border border-white/10 px-2.5 py-2 text-xs text-slate-300 transition-colors hover:border-emerald-400/40 hover:text-white sm:text-sm">
              Yönetim
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-emerald-400/10 blur-3xl" aria-hidden="true" />
          <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
            <div className="animate-fade-up">
              <Badge variant="success" className="mb-6">
                <Sparkles size={13} aria-hidden="true" />
                Yetkili alım duyurusu
              </Badge>
              <h1 className="text-4xl font-bold leading-[1.08] text-white sm:text-5xl lg:text-6xl">
                Ekibin bir parçası <span className="text-emerald-350">ol.</span>
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-400 sm:text-lg">
                Luminacraft Staff Center, topluluğumuza katılmak isteyen oyuncular için şeffaf ve
                tek bir yerden yönetilen başvuru merkezidir. Pozisyonunu seç, soruları yanıtla,
                sürecini takip et.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a href="#pozisyonlar" className="btn-minecraft px-5 py-2.5">
                  Pozisyonları incele
                  <ArrowRight size={16} aria-hidden="true" />
                </a>
                <Link to="/status" className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:border-cyan-300/30 hover:text-white">
                  <Clock3 size={16} aria-hidden="true" />
                  Başvuru durumum
                </Link>
              </div>
              <dl className="mt-10 grid max-w-lg grid-cols-3 gap-4 border-t border-white/5 pt-6">
                <div>
                  <dt className="text-[11px] text-slate-500">Aktif ekip</dt>
                  <dd className="mt-1 font-mono text-xl font-semibold text-white">
                    {String(POSITIONS.length).padStart(2, '0')}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-slate-500">Soru tipi</dt>
                  <dd className="mt-1 font-mono text-xl font-semibold text-white">07</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-slate-500">Süreç</dt>
                  <dd className={applicationsOpen
                    ? 'mt-1 font-mono text-xl font-semibold text-emerald-300'
                    : 'mt-1 font-mono text-xl font-semibold text-amber-300'}>
                    {applicationsOpen ? 'Açık' : 'Kapalı'}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="relative mx-auto w-full max-w-sm animate-fade-up" style={{ animationDelay: '120ms' }}>
              <div className="panel glow-border relative overflow-hidden p-8">
                <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-emerald-400/10 to-transparent" aria-hidden="true" />
                <div className="relative flex flex-col items-center text-center">
                  <LogoMark className="h-28 w-28 drop-shadow-[0_0_24px_rgba(52,224,161,0.35)]" />
                  <p className="mt-4 font-mono text-xs tracking-[0.3em] text-emerald-350">LUMINACRAFT</p>
                  <p className="mt-1 text-sm text-slate-400">Topluluk &amp; Sunucu Ekibi</p>
                </div>
                <div className="relative mt-8 space-y-3 border-t border-white/5 pt-6">
                  {[
                    { icon: Check, text: 'Başvuru anında takip kodu' },
                    { icon: ScrollText, text: 'Pozisyona özel sorular' },
                    { icon: Trophy, text: 'Şeffaf değerlendirme süreci' },
                  ].map((item) => (
                    <p key={item.text} className="flex items-center gap-2.5 text-sm text-slate-300">
                      <item.icon size={15} className="text-emerald-350" aria-hidden="true" />
                      {item.text}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="pozisyonlar" className="mx-auto max-w-6xl scroll-mt-6 px-4 py-12 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="font-mono text-xs tracking-[0.2em] text-cyan-300 uppercase">01 / Pozisyonlar</p>
              <h2 className="mt-2 text-2xl font-bold text-white sm:text-3xl">Açık pozisyonlar</h2>
              <p className="mt-2 text-sm text-slate-400">Sana uygun ekibi seç, başvurunu birkaç dakikada tamamla.</p>
            </div>
          </div>

          {loadState === 'loading' && (
            <div className="mt-8 grid gap-5 sm:grid-cols-2" role="status" aria-live="polite">
              <span className="sr-only">Pozisyonlar yükleniyor...</span>
              <PositionSkeleton />
              <PositionSkeleton />
            </div>
          )}

          {loadState === 'unconfigured' && (
            <div className="panel mt-8 flex flex-col items-center px-6 py-12 text-center">
              <Clock3 size={30} className="text-emerald-350" aria-hidden="true" />
              <h3 className="mt-4 text-lg font-semibold text-white">Başvuru sistemi yakında</h3>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-400">
                Başvuru altyapısı henüz etkinleştirilmedi. Resmî duyuruları bekleyin; şu anda
                oluşturulmuş bir başvuru bulunmuyor.
              </p>
              <Link to="/status" className="btn-minecraft mt-6">
                Var olan başvurumu sorgula
              </Link>
            </div>
          )}

          {loadState === 'ready' && (
            <>
              {loadError && (
                <p role="alert" className="mt-6 rounded-lg border border-amber-400/25 bg-amber-400/5 px-4 py-3 text-sm text-amber-200">
                  {loadError}
                </p>
              )}
              {!applicationsOpen && (
                <div className="mt-8 flex items-start gap-3 rounded-lg border border-amber-400/25 bg-amber-400/5 px-5 py-4">
                  <LockKeyhole size={20} className="mt-0.5 shrink-0 text-amber-300" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-semibold text-amber-100">Başvurular geçici olarak kapalı</p>
                    <p className="mt-1 text-sm leading-relaxed text-amber-100/75">{getClosedMessage(settings)}</p>
                  </div>
                </div>
              )}
              <div className="mt-8 grid gap-5 sm:grid-cols-2">
                {positions.length > 0 ? (
                  positions.map((position) => (
                    <PositionCard key={position.id} position={position} settings={settings} />
                  ))
                ) : (
                  <div className="panel col-span-full px-6 py-10 text-center text-sm text-slate-400">
                    Şu anda listelenen bir pozisyon yok. Yeni duyurular için takipte kalın.
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        <section id="sartlar" className="border-y border-white/5 bg-obsidian-950/40">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-2">
            <div>
              <p className="font-mono text-xs tracking-[0.2em] text-cyan-300 uppercase">02 / Kurallar</p>
              <h2 className="mt-2 text-2xl font-bold text-white sm:text-3xl">Başvuru şartları</h2>
              <p className="mt-3 max-w-lg text-sm leading-relaxed text-slate-400">
                Ekibimize katılmadan önce aşağıdaki koşulları karşıladığınızdan emin olun. Başvurunuz
                bu kriterlere göre değerlendirilir.
              </p>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {REQUIREMENTS.map((requirement) => (
                <li key={requirement} className="flex items-start gap-3 rounded-lg border border-white/5 bg-obsidian-900/60 px-4 py-3.5 text-sm text-slate-300">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
                    <Check size={13} aria-hidden="true" />
                  </span>
                  {requirement}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="sss" className="mx-auto max-w-4xl px-4 py-14 sm:px-6">
          <div className="flex items-center gap-3">
            <HelpCircle size={22} className="text-emerald-350" aria-hidden="true" />
            <div>
              <p className="font-mono text-xs tracking-[0.2em] text-cyan-300 uppercase">03 / SSS</p>
              <h2 className="mt-1 text-2xl font-bold text-white sm:text-3xl">Sıkça sorulan sorular</h2>
            </div>
          </div>
          <div className="mt-8 space-y-3">
            {FAQ.map((item, index) => (
              <details key={item.question} className="panel group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-slate-200 marker:hidden">
                  <span>
                    <span className="mr-2 font-mono text-xs text-emerald-350">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    {item.question}
                  </span>
                  <ChevronDown size={16} className="shrink-0 text-slate-500 transition-transform duration-200 group-open:rotate-180 group-open:text-emerald-350" aria-hidden="true" />
                </summary>
                <p className="mt-3 border-t border-white/5 pt-3 text-sm leading-relaxed text-slate-400">
                  {item.answer}
                </p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-white/5 bg-obsidian-950/80">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2.5">
            <LogoMark className="h-8 w-8" />
            <span className="text-xs text-slate-500">© {new Date().getFullYear()} Luminacraft. Tüm hakları saklıdır.</span>
          </div>
          <nav className="flex gap-5 text-xs text-slate-400" aria-label="Alt menü">
            <Link to="/status" className="hover:text-white">Başvuru durumum</Link>
            <Link to="/admin" className="hover:text-white">Yönetim paneli</Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}

export default HomePage
