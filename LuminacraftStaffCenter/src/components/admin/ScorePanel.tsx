import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { CheckCircle2, ClipboardList, Save, StickyNote } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Textarea'
import { addNote, saveScores } from '../../lib/api-admin'
import { SCORE_CRITERIA } from '../../lib/constants'
import { calculateTotal, isScoreValid, scorePercent } from '../../lib/scoring'
import { cn } from '../../lib/utils'
import { useAdminToast } from './AdminLayout'
import type { ApplicationNote, ApplicationScore } from '../../types'
import { formatDateTime } from '../../lib/utils'

export interface ScorePanelProps {
  applicationId: string
  scores: ApplicationScore[]
  notes?: ApplicationNote[]
  onScoresSaved?: (total: number) => void
  onNoteAdded?: () => void
}

export default function ScorePanel({
  applicationId,
  scores,
  notes = [],
  onScoresSaved,
  onNoteAdded,
}: ScorePanelProps) {
  const notify = useAdminToast()
  const initial = useMemo(() => {
    const map: Record<string, number> = {}
    for (const score of scores ?? []) {
      if (score?.criterion_key && typeof score.points === 'number') {
        map[score.criterion_key] = score.points
      }
    }
    return map
  }, [scores])

  const [values, setValues] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const [savingScores, setSavingScores] = useState(false)
  const [savingNote, setSavingNote] = useState(false)

  useEffect(() => {
    const next: Record<string, string> = {}
    for (const criterion of SCORE_CRITERIA) {
      next[criterion.key] = initial[criterion.key] === undefined ? '' : String(initial[criterion.key])
    }
    setValues(next)
  }, [initial])

  const numericScores = useMemo(() => {
    const map: Record<string, number> = {}
    for (const [key, value] of Object.entries(values)) {
      if (value !== '') map[key] = Number(value)
    }
    return map
  }, [values])

  const total = calculateTotal(numericScores)
  const valid = isScoreValid(numericScores)

  const handleScoreChange = (key: string, value: string, max: number) => {
    if (value === '') {
      setValues((current) => ({ ...current, [key]: '' }))
      return
    }
    const number = Number(value)
    if (!Number.isFinite(number)) return
    setValues((current) => ({ ...current, [key]: String(Math.min(max, Math.max(0, Math.round(number)))) }))
  }

  const handleSaveScores = async (event: FormEvent) => {
    event.preventDefault()
    if (!valid) {
      notify('Puanlar geçersiz. Her kriter kendi üst sınırını aşamaz ve toplam 100ü olamaz.', 'error')
      return
    }
    setSavingScores(true)
    try {
      const result = await saveScores(applicationId, numericScores)
      notify(`Puanlar kaydedildi. Toplam: ${result.total_score}/100`, 'success')
      onScoresSaved?.(result.total_score)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Puanlar kaydedilemedi.', 'error')
    } finally {
      setSavingScores(false)
    }
  }

  const handleSaveNote = async (event: FormEvent) => {
    event.preventDefault()
    if (!note.trim()) {
      notify('Lütfen bir not yazın.', 'error')
      return
    }
    setSavingNote(true)
    try {
      await addNote(applicationId, note.trim())
      setNote('')
      notify('Özel not eklendi.', 'success')
      onNoteAdded?.()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Not eklenemedi.', 'error')
    } finally {
      setSavingNote(false)
    }
  }

  return (
    <div className="space-y-5">
      <Card
        title="Değerlendirme puanları"
        description="Her kriter için 0 ile belirtilen üst sınır arasında puan verin. Toplam 100ü geçemez."
        actions={<ClipboardList size={20} className="text-emerald-300" />}
      >
        <form onSubmit={handleSaveScores} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {SCORE_CRITERIA.map((criterion) => (
              <Input
                key={criterion.key}
                type="number"
                min={0}
                max={criterion.weight}
                step={1}
                label={`${criterion.label} (/${criterion.weight})`}
                value={values[criterion.key] ?? ''}
                placeholder="0"
                onChange={(event) =>
                  handleScoreChange(criterion.key, event.target.value, criterion.weight)
                }
              />
            ))}
          </div>

          <div className="rounded-lg border border-white/10 bg-black/20 p-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-widest text-slate-500">Toplam puan</p>
                <p className={cn('mt-1 text-3xl font-black', valid ? 'text-emerald-300' : 'text-red-300')}>
                  {total}<span className="text-base font-semibold text-slate-500"> / 100</span>
                </p>
              </div>
              <span className="font-mono text-sm text-cyan-300">%{scorePercent(total)}</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/5" aria-hidden="true">
              <div
                className={cn('h-full rounded-full transition-all', valid ? 'bg-emerald-400' : 'bg-red-400')}
                style={{ width: `${scorePercent(total)}%` }}
              />
            </div>
            {!valid && (
              <p className="mt-2 text-xs text-red-300">
                Puanları kontrol edin: kriter sınırları aşılmamalı ve en az bir puan girilmelidir.
              </p>
            )}
          </div>

          <Button type="submit" loading={savingScores} disabled={!valid} icon={<Save size={16} />}>
            Puanları kaydet
          </Button>
        </form>
      </Card>

      <Card
        title="Özel notlar"
        description="Bu notlar yalnızca yöneticiler tarafından görülür, başvurana gösterilmez."
        actions={<StickyNote size={20} className="text-cyan-300" />}
      >
        {notes.length > 0 ? (
          <ul className="mb-5 space-y-2">
            {notes.map((item) => (
              <li key={item.id} className="rounded-lg border border-white/5 bg-black/20 px-3 py-2">
                <p className="whitespace-pre-wrap text-sm text-slate-200">{item.note}</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {formatDateTime(item.created_at)}
                  {item.admin_id ? ` · ${item.admin_id}` : ''}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-5 rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-sm text-slate-500">
            Henüz özel not eklenmedi.
          </p>
        )}
        <form onSubmit={handleSaveNote} className="space-y-3">
          <Textarea
            label="Yeni not"
            rows={3}
            maxLength={2000}
            value={note}
            placeholder="Örn. Telefon görüşmesinde zamanında ulaştı."
            onChange={(event) => setNote(event.target.value)}
          />
          <Button
            type="submit"
            variant="secondary"
            loading={savingNote}
            disabled={!note.trim()}
            icon={<CheckCircle2 size={16} />}
          >
            Notu ekle
          </Button>
        </form>
      </Card>
    </div>
  )
}
