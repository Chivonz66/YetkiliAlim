import { ArrowDown, ArrowUp, ArrowUpDown, Inbox } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { formatDate } from '../../lib/utils'
import { statusLabel } from '../../lib/scoring'
import { POSITIONS } from '../../lib/constants'
import type { Application } from '../../types'

export type ApplicationSortKey = 'tracking_no' | 'applicant_name' | 'position_slug' | 'status' | 'created_at'

interface Column {
  key: ApplicationSortKey
  label: string
}

const COLUMNS: Column[] = [
  { key: 'tracking_no', label: 'Takip no' },
  { key: 'applicant_name', label: 'Başvuran' },
  { key: 'position_slug', label: 'Pozisyon' },
  { key: 'status', label: 'Durum' },
  { key: 'created_at', label: 'Tarih' },
]

export interface ApplicationTableProps {
  applications: Application[]
  sortKey?: ApplicationSortKey
  sortDirection?: 'asc' | 'desc'
  onSort?: (key: ApplicationSortKey) => void
  onRowClick?: (id: string) => void
}

export default function ApplicationTable({
  applications,
  sortKey = 'created_at',
  sortDirection = 'desc',
  onSort,
  onRowClick,
}: ApplicationTableProps) {
  if (applications.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-white/10 px-4 py-12 text-center">
        <Inbox size={30} className="text-slate-600" />
        <p className="font-semibold text-slate-200">Başvuru bulunamadı</p>
        <p className="max-w-sm text-sm text-slate-500">
          Arama veya filtreleri değiştirerek tekrar deneyin.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-white/5">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <thead className="bg-white/[0.03] text-xs uppercase tracking-wider text-slate-400">
          <tr>
            {COLUMNS.map((column) => {
              const active = sortKey === column.key
              const Icon = active ? (sortDirection === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
              return (
                <th key={column.key} scope="col" className="px-4 py-3 font-semibold">
                  <button
                    type="button"
                    onClick={() => onSort?.(column.key)}
                    disabled={!onSort}
                    className="inline-flex items-center gap-1.5 transition-colors hover:text-white disabled:cursor-default"
                    aria-label={`${column.label} alanına göre sırala`}
                  >
                    {column.label}
                    <Icon size={13} className={active ? 'text-emerald-300' : 'text-slate-600'} />
                  </button>
                </th>
              )
            })}
            <th scope="col" className="px-4 py-3 text-right font-semibold">
              Detay
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {applications.map((application) => (
            <tr
              key={application.id}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={() => onRowClick?.(application.id)}
              onKeyDown={(event) => {
                if (onRowClick && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault()
                  onRowClick(application.id)
                }
              }}
              className={`transition-colors ${onRowClick ? 'cursor-pointer hover:bg-emerald-400/[0.06] focus:bg-emerald-400/[0.06] focus:outline-none' : ''}`}
            >
              <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-emerald-200">
                {application.tracking_no}
              </td>
              <td className="px-4 py-3">
                <p className="font-medium text-slate-100">{application.applicant_name}</p>
                <p className="text-xs text-slate-500">{application.applicant_email}</p>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-300">
                {POSITIONS.find((position) => position.slug === application.position_slug)?.label ??
                  application.position_slug}
              </td>
              <td className="px-4 py-3">
                <Badge variant={application.status}>{statusLabel(application.status)}</Badge>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-400">
                {formatDate(application.created_at || application.submitted_at || '')}
              </td>
              <td className="px-4 py-3 text-right text-xs font-semibold text-emerald-300">Görüntüle →</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
