import { useEffect, useState } from 'react'
import { BriefcaseBusiness, RefreshCw, Save } from 'lucide-react'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Spinner } from '../../components/ui/Spinner'
import { Textarea } from '../../components/ui/Textarea'
import { useAdminToast } from '../../components/admin/AdminLayout'
import { listPositions, updatePosition } from '../../lib/api-admin'
import { POSITIONS } from '../../lib/constants'
import type { Position } from '../../types'

/** `is_open` positions sütunu değil, `${slug}_applications_open` app_settings anahtarıdır. */
type PositionWithOpen = Position & { is_open?: boolean }

interface Draft {
  description: string
  is_active: boolean
  is_open: boolean
  dirty: boolean
  saving: boolean
}

function initialDraft(position: PositionWithOpen): Draft {
  return {
    description: position.description ?? '',
    is_active: position.is_active !== false,
    is_open: position.is_open !== false,
    dirty: false,
    saving: false,
  }
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  hint: string
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-white/5 bg-black/20 px-3 py-2.5">
      <span>
        <span className="block text-sm font-semibold text-slate-100">{label}</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
        aria-label={label}
      />
      <span
        aria-hidden="true"
        className="relative h-6 w-11 shrink-0 rounded-full border border-white/10 bg-white/10 transition-colors peer-checked:border-emerald-400/40 peer-checked:bg-emerald-400/30 [&>span]:transition-all peer-checked:[&>span]:translate-x-5 peer-checked:[&>span]:bg-emerald-300"
      >
        <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-slate-400" />
      </span>
    </label>
  )
}

export default function PositionsPage() {
  const [positions, setPositions] = useState<PositionWithOpen[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const notify = useAdminToast()

  useEffect(() => {
    let active = true
    setLoading(true)
    listPositions()
      .then((items) => {
        if (!active) return
        setPositions(items)
        setDrafts(Object.fromEntries(items.map((item) => [item.id, initialDraft(item)])))
      })
      .catch((caught) => {
        if (active) notify(caught instanceof Error ? caught.message : 'Pozisyonlar yüklenemedi.', 'error')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [reloadKey, notify])

  const updateDraft = (id: string, changes: Partial<Draft>) => {
    setDrafts((current) => ({
      ...current,
      [id]: { ...(current[id] as Draft), ...changes, dirty: true },
    }))
  }

  const handleSave = async (position: Position) => {
    const draft = drafts[position.id]
    if (!draft) return
    setDrafts((current) => ({ ...current, [position.id]: { ...draft, saving: true } }))
    try {
      await updatePosition({
        id: position.id,
        description: draft.description,
        is_active: draft.is_active,
        is_open: draft.is_open,
      })
      notify(`${position.name} pozisyonu güncellendi.`, 'success')
      setReloadKey((key) => key + 1)
    } catch (caught) {
      setDrafts((current) => ({ ...current, [position.id]: { ...draft, saving: false } }))
      notify(caught instanceof Error ? caught.message : 'Pozisyon güncellenemedi.', 'error')
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3" role="status">
        <Spinner size={32} />
        <p className="text-sm text-slate-400">Pozisyonlar yükleniyor...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-black text-white">Pozisyonlar</h1>
          <p className="mt-1 text-sm text-slate-400">
            Ekip pozisyonlarını açın/kapatın ve başvuru formunda görünen açıklamaları düzenleyin.
          </p>
        </div>
        <Button
          variant="secondary"
          icon={<RefreshCw size={16} />}
          onClick={() => setReloadKey((key) => key + 1)}
        >
          Yenile
        </Button>
      </header>

      {positions.length === 0 ? (
        <Card>
          <p className="py-10 text-center text-sm text-slate-500">Kayıtlı pozisyon bulunamadı.</p>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {positions.map((position) => {
            const draft = drafts[position.id] ?? initialDraft(position)
            const meta = POSITIONS.find((item) => item.slug === position.slug)
            return (
              <Card
                key={position.id}
                title={
                  <span className="flex items-center gap-2">
                    <BriefcaseBusiness size={18} className="text-cyan-300" /> {position.name}
                  </span>
                }
                description={meta?.description}
                actions={
                  <Badge variant={draft.is_active ? 'success' : 'default'}>
                    {draft.is_active ? 'Aktif' : 'Pasif'}
                  </Badge>
                }
              >
                <div className="space-y-4">
                  <Toggle
                    label="Pozisyon aktif"
                    hint="Kapalıysa başvuru formunda görünmez."
                    checked={draft.is_active}
                    onChange={(value) => updateDraft(position.id, { is_active: value })}
                  />
                  <Toggle
                    label="Başvurular açık"
                    hint="Kapalıysa bu pozisyona yeni başvuru alınmaz."
                    checked={draft.is_open}
                    onChange={(value) => updateDraft(position.id, { is_open: value })}
                  />
                  <Textarea
                    label="Başvuru formu açıklaması"
                    rows={4}
                    maxLength={2000}
                    value={draft.description}
                    placeholder="Bu ekipte görev alarak neler yapacaksınız?"
                    onChange={(event) => updateDraft(position.id, { description: event.target.value })}
                  />
                  <div className="flex items-center justify-between gap-3 border-t border-white/5 pt-4">
                    <p className="text-xs text-slate-500">
                      {draft.dirty ? 'Kaydedilmemiş değişiklikler var' : 'Tüm değişiklikler kayıtlı'}
                    </p>
                    <Button
                      loading={draft.saving}
                      disabled={!draft.dirty}
                      icon={<Save size={16} />}
                      onClick={() => handleSave(position)}
                    >
                      Kaydet
                    </Button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
