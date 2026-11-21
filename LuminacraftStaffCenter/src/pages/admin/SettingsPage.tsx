import { useEffect, useState, type FormEvent } from 'react'
import { RefreshCw, Save, Settings2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Spinner } from '../../components/ui/Spinner'
import { Textarea } from '../../components/ui/Textarea'
import { useAdminToast } from '../../components/admin/AdminLayout'
import { getSettings, updateSettings } from '../../lib/api-admin'

function asBool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return ['true', '1', 'evet', 'yes', 'on'].includes(value.trim().toLowerCase())
  return fallback
}

function asNumber(value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback
}

function asText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? fallback : String(value)
}

function Switch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-white/5 bg-black/20 p-4">
      <span>
        <span className="block text-sm font-semibold text-slate-100">{label}</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
      <input
        type="checkbox"
        className="h-5 w-5 shrink-0 accent-emerald-400"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={label}
      />
    </label>
  )
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [form, setForm] = useState({
    applications_open: true,
    closed_message: '',
    rate_limit_per_ip_per_hour: 5,
    site_title: 'Luminacraft Staff Center',
  })
  const notify = useAdminToast()

  useEffect(() => {
    let active = true
    setLoading(true)
    getSettings()
      .then((data) => {
        if (!active) return
        setForm({
          applications_open: asBool(data.applications_open, true),
          closed_message: asText(
            data.closed_message,
            'Başvurular şu anda kapalı. Yeni duyurular için bizi takip edin.',
          ),
          rate_limit_per_ip_per_hour: asNumber(data.rate_limit_per_ip_per_hour, 5),
          site_title: asText(data.site_title, 'Luminacraft Staff Center'),
        })
        setDirty(false)
      })
      .catch((caught) => {
        if (active) notify(caught instanceof Error ? caught.message : 'Ayarlar yüklenemedi.', 'error')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [notify])

  const change = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setDirty(true)
  }

  const handleSave = async (event: FormEvent) => {
    event.preventDefault()
    if (form.rate_limit_per_ip_per_hour < 1 || form.rate_limit_per_ip_per_hour > 1000) {
      notify('Hız sınırı 1 ile 1000 arasında olmalıdır.', 'error')
      return
    }
    setSaving(true)
    try {
      await updateSettings({
        applications_open: form.applications_open,
        closed_message: form.closed_message,
        rate_limit_per_ip_per_hour: form.rate_limit_per_ip_per_hour,
        site_title: form.site_title,
      })
      setDirty(false)
      notify('Sistem ayarları kaydedildi.', 'success')
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Ayarlar kaydedilemedi.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-black text-white">Ayarlar</h1>
          <p className="mt-1 text-sm text-slate-400">
            Başvuru akışını, hız sınırlarını ve genel site ayarlarını yönetin.
          </p>
        </div>
        <Button
          variant="secondary"
          icon={<RefreshCw size={16} />}
          onClick={() => window.location.reload()}
          loading={loading}
        >
          Yeniden yükle
        </Button>
      </header>

      {loading ? (
        <div className="flex min-h-[300px] flex-col items-center justify-center gap-3" role="status">
          <Spinner size={30} />
          <p className="text-sm text-slate-400">Ayarlar yükleniyor...</p>
        </div>
      ) : (
        <form onSubmit={handleSave} noValidate className="space-y-5">
          <Card title="Başvuru akışı" description="Başvuruların açık olup olmadığını ve kapanış mesajını belirleyin.">
            <div className="space-y-4">
              <Switch
                label="Başvurular açık"
                hint="Kapatıldığında başvuru formu yerine açıklama gösterilir."
                checked={form.applications_open}
                onChange={(value) => change('applications_open', value)}
              />
              <Textarea
                label="Kapalı mesajı"
                rows={3}
                maxLength={4000}
                value={form.closed_message}
                placeholder="Başvurular şu anda kapalı..."
                hint="Başvurular kapatıldığında ziyaretçilere gösterilen Türkçe mesaj."
                onChange={(event) => change('closed_message', event.target.value)}
              />
            </div>
          </Card>

          <Card title="Genel ve güvenlik" description="Site başlığı ve IP başına başvuru sınırı.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Site başlığı"
                maxLength={200}
                value={form.site_title}
                onChange={(event) => change('site_title', event.target.value)}
              />
              <Input
                label="Saatlik başvuru sınırı (IP)"
                type="number"
                min={1}
                max={1000}
                value={form.rate_limit_per_ip_per_hour}
                onChange={(event) => change('rate_limit_per_ip_per_hour', Number(event.target.value))}
                hint="Aşırı başvuruları engellemek için kullanılır."
              />
            </div>
          </Card>

          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <p className="text-xs text-slate-500">
              {dirty ? 'Kaydedilmemiş değişiklikler var.' : 'Tüm ayarlar güncel.'}
            </p>
            <Button type="submit" loading={saving} disabled={!dirty} icon={<Save size={16} />}>
              Sistem ayarlarını kaydet
            </Button>
          </div>
        </form>
      )}

      <p className="flex items-center gap-2 text-xs text-slate-500">
        <Settings2 size={14} className="text-emerald-300" />
        Gizli anahtarlar bu panelde yönetilmez; yalnızca Supabase Edge ortamında tutulur.
      </p>
    </div>
  )
}
