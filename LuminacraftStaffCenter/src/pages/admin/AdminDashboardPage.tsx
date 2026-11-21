import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  Eye,
  FileStack,
  ListChecks,
  TrendingUp,
  XCircle,
} from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import ApplicationTable from '../../components/admin/ApplicationTable'
import { useAdminToast } from '../../components/admin/AdminLayout'
import { listApplications, listPositions } from '../../lib/api-admin'
import { APPLICATION_STATUSES, POSITIONS } from '../../lib/constants'
import { statusLabel } from '../../lib/scoring'
import type { Application, ApplicationStatus, Position } from '../../types'

interface StatCardProps {
  label: string
  value: number | string
  icon: typeof FileStack
  tone: string
}

function StatCard({ label, value, icon: Icon, tone }: StatCardProps) {
  return (
    <div className="panel flex items-center gap-4 p-4">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${tone}`}>
        <Icon size={20} />
      </div>
      <div>
        <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-black text-white">{value}</p>
      </div>
    </div>
  )
}

export default function AdminDashboardPage() {
  const [applications, setApplications] = useState<Application[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const notify = useAdminToast()

  useEffect(() => {
    let active = true
    Promise.all([listApplications({ limit: 200 }), listPositions()])
      .then(([apps, pos]) => {
        if (!active) return
        setApplications(apps.applications)
        setTotal(apps.total)
        setPositions(pos)
      })
      .catch((caught) => {
        if (!active) return
        const message = caught instanceof Error ? caught.message : 'Panel verileri yüklenemedi.'
        setError(message)
        notify(message, 'error')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [notify])

  const stats = useMemo(() => {
    const count = (status: ApplicationStatus) =>
      applications.filter((application) => application.status === status).length
    const decided = count('accepted') + count('rejected')
    return {
      pending: count('pending'),
      reviewing: count('reviewing'),
      accepted: count('accepted'),
      rejected: count('rejected'),
      acceptanceRate: decided > 0 ? Math.round((count('accepted') / decided) * 100) : 0,
      rehber: applications.filter((application) => application.position_slug === 'rehber').length,
      aac: applications.filter((application) => application.position_slug === 'aac').length,
    }
  }, [applications])

  if (loading) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3" role="status">
        <Spinner size={32} />
        <p className="text-sm text-slate-400">Panel istatistikleri hazırlanıyor...</p>
      </div>
    )
  }

  if (error && applications.length === 0) {
    return (
      <Card title="Panel yüklenemedi">
        <p role="alert" className="text-sm text-red-300">{error}</p>
        <Button className="mt-4" onClick={() => window.location.reload()}>
          Tekrar dene
        </Button>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-black text-white">Panelim</h1>
          <p className="mt-1 text-sm text-slate-400">
            Başvuruların genel durumu ve ekip özeti. Tüm veriler canlı olarak yüklenir.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/admin/applications">
            <Button variant="secondary" icon={<FileStack size={16} />}>Tüm başvurular</Button>
          </Link>
          <Link to="/admin/questions">
            <Button icon={<ListChecks size={16} />}>Soruları yönet</Button>
          </Link>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Genel istatistikler">
        <StatCard label="Toplam başvuru" value={total} icon={FileStack} tone="bg-cyan-400/10 text-cyan-300" />
        <StatCard label="Beklemede" value={stats.pending} icon={Clock3} tone="bg-amber-400/10 text-amber-300" />
        <StatCard label="İnceleniyor" value={stats.reviewing} icon={Eye} tone="bg-violet-400/10 text-violet-300" />
        <StatCard label="Kabul edildi" value={stats.accepted} icon={CheckCircle2} tone="bg-emerald-400/10 text-emerald-300" />
      </section>

      <section className="grid gap-5 lg:grid-cols-3">
        <Card title="Karar özeti" description="Başvuru durumlarının dağılımı">
          <div className="space-y-3">
            {APPLICATION_STATUSES.map((status) => {
              const count = stats[status.value]
              const percent = total > 0 ? Math.round((count / total) * 100) : 0
              return (
                <div key={status.value}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-slate-300">{status.label}</span>
                    <span className="font-mono text-slate-500">{count} · %{percent}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/5">
                    <div
                      className={`h-full rounded-full transition-all ${
                        status.value === 'accepted'
                          ? 'bg-emerald-400'
                          : status.value === 'rejected'
                            ? 'bg-red-400'
                            : status.value === 'reviewing'
                              ? 'bg-cyan-400'
                              : 'bg-amber-400'
                      }`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-5 flex items-center gap-2 rounded-lg border border-emerald-400/15 bg-emerald-400/5 px-3 py-2 text-sm text-emerald-200">
            <TrendingUp size={16} /> Kabul oranı: <strong className="ml-auto">%{stats.acceptanceRate}</strong>
          </div>
        </Card>

        <Card title="Pozisyon dağılımı" description="Başvuruların ekip bazında kırılımı">
          <div className="space-y-4">
            {POSITIONS.map((position) => {
              const count = position.slug === 'rehber' ? stats.rehber : stats.aac
              const record = positions.find((item) => item.slug === position.slug)
              return (
                <div key={position.slug} className="rounded-lg border border-white/5 bg-black/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <BriefcaseBusiness size={16} className="text-cyan-300" />
                      <span className="font-semibold text-slate-100">{position.label}</span>
                    </div>
                    <span className="text-lg font-bold text-white">{count}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {record?.is_active === false ? 'Pozisyon pasif' : 'Pozisyon aktif'}
                  </p>
                </div>
              )
            })}
            <div className="flex items-center justify-between rounded-lg border border-white/5 bg-black/20 p-3 text-sm">
              <span className="flex items-center gap-2 text-slate-300">
                <XCircle size={16} className="text-red-300" /> Reddedilen
              </span>
              <strong className="text-white">{stats.rejected}</strong>
            </div>
          </div>
        </Card>

        <Card title="Hızlı not" description="Yönetici paneli kullanım ipuçları">
          <ul className="space-y-3 text-sm text-slate-400">
            <li className="flex gap-2"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-300" /> Başvuru detayından puan ve özel not ekleyebilirsiniz.</li>
            <li className="flex gap-2"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-300" /> Soruları sürükleyerek sıralayabilir, klavye ile de taşıyabilirsiniz.</li>
          </ul>
          <Link to="/admin/settings" className="mt-5 inline-flex items-center gap-1 text-sm text-emerald-300 hover:underline">
            Ayarları gözden geçir <ArrowRight size={14} />
          </Link>
        </Card>
      </section>

      <Card
        title="Son başvurular"
        description="En yeni başvuruları görüntüleyin ve incelemeye başlayın."
        actions={<Badge variant="info">{Math.min(applications.length, 5)} kayıt</Badge>}
      >
        <ApplicationTable
          applications={applications.slice(0, 5)}
          onRowClick={(id) => navigate(`/admin/applications/${id}`)}
        />
        {total > applications.length && (
          <p className="mt-3 text-xs text-slate-500">
            Listede son {applications.length} başvuru gösteriliyor; toplam {total} kayıt var.
          </p>
        )}
      </Card>
    </div>
  )
}
