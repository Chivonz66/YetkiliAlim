import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  BellRing,
  CalendarDays,
  CheckCircle2,
  Circle,
  Clock3,
  Search,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import { Badge, type BadgeVariant } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import {
  NOT_CONFIGURED_MESSAGE,
  lookupStatus,
  type StatusLookupResponse,
} from '../lib/api-public'
import { APPLICATION_STATUSES } from '../lib/constants'
import { cn, formatDateTime } from '../lib/utils'

const TIMELINE = [
  { key: 'received', label: 'Başvuru alındı', description: 'Başvurun sisteme güvenle kaydedildi.' },
  { key: 'reviewing', label: 'İnceleniyor', description: 'Ekip başvurunu değerlendiriyor.' },
  { key: 'decision', label: 'Karar', description: 'Değerlendirme sonucu açıklandı.' },
]

function stageIndex(status?: string): number {
  if (status === 'reviewing') return 1
  if (status === 'accepted' || status === 'rejected') return 2
  return 0
}

function statusMeta(status?: string) {
  const found = APPLICATION_STATUSES.find((item) => item.status === status)
  const variant: BadgeVariant =
    status === 'accepted' ? 'accepted'
      : status === 'rejected' ? 'rejected'
        : status === 'reviewing' ? 'reviewing'
          : 'pending'
  return { label: found?.label ?? 'Durum bilinmiyor', description: found?.description ?? '', variant }
}

function discordMeta(result: StatusLookupResponse): { label: string; variant: BadgeVariant } {
  const notification = result.discord_notification
  const state =
    typeof notification === 'string'
      ? notification
      : notification && typeof notification === 'object'
        ? notification.status
        : undefined

  if (state === 'sent' || result.discord_notified === true) {
    return { label: 'Discord bildirimi gönderildi', variant: 'success' }
  }
  if (state === 'failed') return { label: 'Discord bildirimi iletilemedi', variant: 'danger' }
  if (state === 'pending') return { label: 'Discord bildirimi hazırlanıyor', variant: 'warning' }
  return { label: 'Henüz bir Discord bildirimi yok', variant: 'default' }
}

/** Yalnızca başvuruya ait genel alanları gösterir; özel not ve puanlar asla render edilmez. */
function ResultCard({ result, trackingNo }: { result: StatusLookupResponse; trackingNo: string }) {
  const current = stageIndex(result.status)
  const meta = statusMeta(result.status)
  const discord = discordMeta(result)
  const decisionDate = result.decision_date || result.reviewed_at || null
  const accepted = result.status === 'accepted'
  const rejected = result.status === 'rejected'

  return (
    <section className="panel animate-fade-up overflow-hidden" aria-live="polite">
      <header className="flex flex-col gap-4 border-b border-white/5 px-5 py-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-mono text-xs tracking-[0.16em] text-emerald-350 uppercase">Başvuru durumu</p>
          <h2 className="mt-1.5 break-all font-mono text-lg font-semibold text-white">
            {result.tracking_no || trackingNo}
          </h2>
        </div>
        <Badge variant={meta.variant} className="self-start">
          {accepted ? <CheckCircle2 size={14} aria-hidden="true" /> : rejected ? <XCircle size={14} aria-hidden="true" /> : <Clock3 size={14} aria-hidden="true" />}
          {meta.label}
        </Badge>
      </header>

      <div className="px-5 py-6">
        <ol className="relative space-y-6 sm:space-y-0 sm:grid sm:grid-cols-3 sm:gap-4">
          {TIMELINE.map((stage, index) => {
            const done = index < current || (index === current && accepted)
            const isCurrent = index === current
            const failed = index === 2 && rejected
            return (
              <li key={stage.key} className="relative flex gap-3 sm:flex-col sm:gap-3">
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border',
                    failed && 'border-red-400/40 bg-red-400/10 text-red-300',
                    done && !failed && 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
                    isCurrent && !done && !failed && 'border-cyan-350/50 bg-cyan-350/10 text-cyan-200',
                    !isCurrent && !done && !failed && 'border-white/10 bg-white/5 text-slate-600',
                  )}
                >
                  {failed ? <XCircle size={17} /> : done ? <CheckCircle2 size={17} /> : isCurrent ? <Clock3 size={17} /> : <Circle size={15} />}
                </span>
                <div className="min-w-0">
                  <p className={cn('text-sm font-medium', isCurrent || done ? 'text-white' : 'text-slate-500')}>
                    {stage.label}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">{stage.description}</p>
                </div>
              </li>
            )
          })}
        </ol>

        <div className="mt-8 grid gap-3 border-t border-white/5 pt-6 sm:grid-cols-2">
          <div className="rounded-lg border border-white/5 bg-obsidian-900/50 px-4 py-3">
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <CalendarDays size={14} aria-hidden="true" /> Başvuru tarihi
            </p>
            <p className="mt-1 text-sm text-slate-200">
              {result.submitted_at ? formatDateTime(result.submitted_at) : '—'}
            </p>
          </div>
          <div className="rounded-lg border border-white/5 bg-obsidian-900/50 px-4 py-3">
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <CalendarDays size={14} aria-hidden="true" /> Karar tarihi
            </p>
            <p className="mt-1 text-sm text-slate-200">
              {decisionDate ? formatDateTime(decisionDate) : 'Henüz karar verilmedi'}
            </p>
          </div>
          <div className="rounded-lg border border-white/5 bg-obsidian-900/50 px-4 py-3 sm:col-span-2">
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <BellRing size={14} aria-hidden="true" /> Bildirim durumu
            </p>
            <Badge variant={discord.variant} className="mt-2">{discord.label}</Badge>
          </div>
        </div>

        <p className="mt-6 text-xs leading-relaxed text-slate-500">
          {meta.description} Başvurunuzla ilgili özel notlar ve puanlar yalnızca yönetim ekibi tarafından görüntülenir.
        </p>
      </div>
    </section>
  )
}

export function StatusPage() {
  const [trackingNo, setTrackingNo] = useState('')
  const [queryToken, setQueryToken] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<StatusLookupResponse | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (!trackingNo.trim() || !queryToken.trim()) {
      setError('Başvuru numarası ve sorgu kodu zorunludur.')
      return
    }
    setLoading(true)
    try {
      const response = await lookupStatus(trackingNo, queryToken)
      setResult(response)
    } catch (cause) {
      const apiError = cause as { code?: string; message?: string }
      setError(apiError?.code === 'NOT_CONFIGURED' ? NOT_CONFIGURED_MESSAGE : apiError?.message ?? 'Sorgulama yapılamadı.')
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="pixel-grid min-h-screen">
      <header className="border-b border-white/5 bg-obsidian-950/70 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5" aria-label="Luminacraft ana sayfa">
            <span className="flex h-9 w-9 items-center justify-center rounded-md border border-emerald-400/40 bg-emerald-400/10 font-mono text-lg font-bold text-emerald-350">L</span>
            <span className="leading-tight">
              <span className="block text-sm font-bold tracking-wide text-white">LUMINACRAFT</span>
              <span className="block font-mono text-[10px] tracking-[0.2em] text-emerald-350">STAFF CENTER</span>
            </span>
          </Link>
          <nav className="flex items-center gap-3 text-xs sm:text-sm" aria-label="Durum menüsü">
            <Link to="/" className="text-slate-400 transition-colors hover:text-white">Ana sayfa</Link>
            <Link to="/admin" className="rounded-md border border-white/10 px-3 py-2 text-slate-300 transition-colors hover:border-emerald-400/40 hover:text-white">Yönetim</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="mb-8 text-center">
          <Badge variant="info" className="mb-4"><ShieldCheck size={13} aria-hidden="true" /> Gizli sorgulama</Badge>
          <h1 className="text-3xl font-bold text-white sm:text-4xl">Başvuru durumum</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-slate-400">
            Başvuru sırasında verilen başvuru numarası ve sorgu kodunu girerek durumunu
            öğrenebilirsin. Bu bilgiler yalnızca sana aittir.
          </p>
        </div>

        <form onSubmit={(event) => void handleSubmit(event)} noValidate className="panel p-5 sm:p-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <Input
              label="Başvuru numarası"
              required
              placeholder="LSC-2026-XXXXXX"
              value={trackingNo}
              onChange={(event) => setTrackingNo(event.target.value)}
              className="font-mono uppercase"
              autoComplete="off"
            />
            <Input
              label="Sorgu kodu"
              required
              type="password"
              placeholder="64 karakterli kod"
              value={queryToken}
              onChange={(event) => setQueryToken(event.target.value)}
              className="font-mono"
              autoComplete="off"
            />
          </div>

          {error && (
            <p role="alert" className="mt-5 flex items-start gap-2 rounded-lg border border-red-400/30 bg-red-400/5 px-4 py-3 text-sm leading-relaxed text-red-200">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500">Sorgu kodunu kimseyle paylaşmayın.</p>
            <Button type="submit" loading={loading} icon={loading ? undefined : <Search size={16} />}>
              {loading ? 'Sorgulanıyor...' : 'Başvuruyu sorgula'}
            </Button>
          </div>
        </form>

        {result && (
          <div className="mt-6">
            <ResultCard result={result} trackingNo={trackingNo} />
          </div>
        )}

        {!result && !error && (
          <div className="mt-8 rounded-lg border border-white/5 bg-obsidian-900/30 px-5 py-6">
            <h2 className="text-sm font-semibold text-slate-200">Nasıl çalışır?</h2>
            <ol className="mt-3 space-y-2 text-sm text-slate-400">
              <li className="flex gap-2"><span className="font-mono text-emerald-350">01</span> Başvuru numaranı ve sorgu kodunu gir.</li>
              <li className="flex gap-2"><span className="font-mono text-emerald-350">02</span> Başvurunun hangi aşamada olduğunu gör.</li>
              <li className="flex gap-2"><span className="font-mono text-emerald-350">03</span> Karar verildiğinde tarih ve bildirim durumunu incele.</li>
            </ol>
          </div>
        )}

        <div className="mt-10 flex items-center justify-center">
          <Link to="/" className="inline-flex items-center gap-2 text-xs text-slate-500 hover:text-white">
            <ArrowLeft size={14} aria-hidden="true" /> Ana sayfaya dön
          </Link>
        </div>
      </main>
    </div>
  )
}

export default StatusPage
