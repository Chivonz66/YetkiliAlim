import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, RefreshCw, Search, SlidersHorizontal } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Spinner } from '../../components/ui/Spinner'
import ApplicationTable, {
  type ApplicationSortKey,
} from '../../components/admin/ApplicationTable'
import { useAdminToast } from '../../components/admin/AdminLayout'
import { listApplications } from '../../lib/api-admin'
import { APPLICATION_STATUSES, POSITIONS } from '../../lib/constants'
import type { Application, ApplicationStatus, PositionSlug } from '../../types'

const PAGE_SIZE = 10

export default function ApplicationsPage() {
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<ApplicationStatus | 'all'>('all')
  const [position, setPosition] = useState<PositionSlug | 'all'>('all')
  const [offset, setOffset] = useState(0)
  const [applications, setApplications] = useState<Application[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [sortKey, setSortKey] = useState<ApplicationSortKey>('created_at')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const navigate = useNavigate()
  const notify = useAdminToast()

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim())
      setOffset(0)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    let active = true
    setLoading(true)
    listApplications({ status, position_slug: position, search, limit: PAGE_SIZE, offset })
      .then((result) => {
        if (!active) return
        setApplications(result.applications)
        setTotal(result.total)
      })
      .catch((caught) => {
        if (!active) return
        notify(
          caught instanceof Error ? caught.message : 'Başvurular yüklenemedi.',
          'error',
        )
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [status, position, search, offset, refreshKey, notify])

  const sorted = useMemo(() => {
    const rows = [...applications]
    rows.sort((a, b) => {
      let left: string | number = a[sortKey] ?? ''
      let right: string | number = b[sortKey] ?? ''
      if (typeof left === 'string') left = left.toLocaleLowerCase('tr')
      if (typeof right === 'string') right = right.toLocaleLowerCase('tr')
      if (left < right) return sortDirection === 'asc' ? -1 : 1
      if (left > right) return sortDirection === 'asc' ? 1 : -1
      return 0
    })
    return rows
  }, [applications, sortKey, sortDirection])

  const handleSort = (key: ApplicationSortKey) => {
    if (key === sortKey) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDirection('asc')
    }
  }

  const first = total === 0 ? 0 : offset + 1
  const last = Math.min(offset + PAGE_SIZE, total)

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-black text-white">Başvurular</h1>
          <p className="mt-1 text-sm text-slate-400">
            Tüm başvuruları arayın, filtreleyin ve detay sayfasından değerlendirin.
          </p>
        </div>
        <Button
          variant="secondary"
          icon={<RefreshCw size={16} />}
          onClick={() => setRefreshKey((key) => key + 1)}
          loading={loading}
        >
          Yenile
        </Button>
      </header>

      <Card>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px]">
          <Input
            label="Ara"
            type="search"
            value={searchInput}
            placeholder="Takip no, kullanıcı adı veya e-posta"
            suffix={<Search size={16} />}
            onChange={(event) => setSearchInput(event.target.value)}
          />
          <Select
            label="Durum"
            value={status}
            options={[
              { value: 'all', label: 'Tüm durumlar' },
              ...APPLICATION_STATUSES.map((item) => ({ value: item.value, label: item.label })),
            ]}
            onChange={(event) => {
              setStatus(event.target.value as ApplicationStatus | 'all')
              setOffset(0)
            }}
          />
          <Select
            label="Pozisyon"
            value={position}
            options={[
              { value: 'all', label: 'Tüm pozisyonlar' },
              ...POSITIONS.map((item) => ({ value: item.slug, label: item.label })),
            ]}
            onChange={(event) => {
              setPosition(event.target.value as PositionSlug | 'all')
              setOffset(0)
            }}
          />
        </div>
        <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
          <SlidersHorizontal size={14} />
          <span>
            {loading ? 'Filtreler uygulanıyor...' : `${total} başvuru bulundu · ${first}-${last} gösteriliyor`}
          </span>
        </div>
      </Card>

      <Card>
        {loading ? (
          <div className="flex min-h-[240px] flex-col items-center justify-center gap-3" role="status">
            <Spinner size={30} />
            <p className="text-sm text-slate-400">Başvurular yükleniyor...</p>
          </div>
        ) : (
          <>
            <ApplicationTable
              applications={sorted}
              sortKey={sortKey}
              sortDirection={sortDirection}
              onSort={handleSort}
              onRowClick={(id) => navigate(`/admin/applications/${id}`)}
            />
            {total > PAGE_SIZE && (
              <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
                <p className="text-xs text-slate-500">
                  Sayfa {Math.floor(offset / PAGE_SIZE) + 1} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    icon={<ChevronLeft size={16} />}
                    disabled={offset === 0}
                    onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
                  >
                    Önceki
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={offset + PAGE_SIZE >= total}
                    onClick={() => setOffset((current) => current + PAGE_SIZE)}
                  >
                    Sonraki <ChevronRight size={16} />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  )
}
