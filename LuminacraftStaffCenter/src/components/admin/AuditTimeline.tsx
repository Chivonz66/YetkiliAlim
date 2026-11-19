import { History, ShieldCheck } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { formatDateTime } from '../../lib/utils'
import { statusLabel } from '../../lib/scoring'
import type { ApplicationStatus } from '../../types'

export interface TimelineEntry {
  id: string
  created_at: string
  action?: string | null
  from_status?: ApplicationStatus | string | null
  to_status?: ApplicationStatus | string | null
  note?: string | null
  changed_by?: string | null
  admin_id?: string | null
  details?: Record<string, unknown> | null
}

const ACTION_LABELS: Record<string, string> = {
  application_status_change: 'Durum güncellendi',
  question_create: 'Soru eklendi',
  question_update: 'Soru güncellendi',
  question_delete: 'Soru silindi',
  question_reorder: 'Soru sırası değiştirildi',
  position_update: 'Pozisyon güncellendi',
  position_create: 'Pozisyon eklendi',
  scores_update: 'Puanlar kaydedildi',
  note_create: 'Özel not eklendi',
  settings_update: 'Ayarlar güncellendi',
  admin_login: 'Giriş yapıldı',
  admin_logout: 'Çıkış yapıldı',
  admin_setup: 'Yönetici oluşturuldu',
}

function labelFor(entry: TimelineEntry): string {
  if (entry.to_status) {
    return entry.from_status
      ? `${statusLabel(entry.from_status)} → ${statusLabel(entry.to_status)}`
      : statusLabel(entry.to_status)
  }
  if (entry.action) return ACTION_LABELS[entry.action] ?? entry.action
  return 'Kayıt güncellendi'
}

export default function AuditTimeline({ entries }: { entries: TimelineEntry[] }) {
  if (!entries || entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-white/10 px-4 py-8 text-center">
        <History size={26} className="text-slate-600" />
        <p className="text-sm text-slate-400">Henüz bir hareket kaydı yok.</p>
      </div>
    )
  }

  return (
    <ol className="relative space-y-4 border-l border-white/10 pl-5" aria-label="İşlem geçmişi">
      {entries.map((entry) => (
        <li key={entry.id} className="relative">
          <span className="absolute -left-[27px] top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-emerald-400/40 bg-obsidian-900 text-emerald-300">
            <ShieldCheck size={9} />
          </span>
          <div className="rounded-lg border border-white/5 bg-black/20 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-100">{labelFor(entry)}</p>
              <time className="text-xs text-slate-500" dateTime={entry.created_at}>
                {formatDateTime(entry.created_at)}
              </time>
            </div>
            {entry.note && <p className="mt-2 text-sm text-slate-400">“{entry.note}”</p>}
            {(entry.changed_by || entry.admin_id) && (
              <Badge variant="default" className="mt-2 text-[10px]">
                {String(entry.changed_by ?? entry.admin_id)}
              </Badge>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}
