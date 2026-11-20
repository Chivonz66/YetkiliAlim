import { useEffect, useState, type FormEvent } from 'react'
import {
  AlertTriangle,
  ExternalLink,
  Globe2,
  KeyRound,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
} from 'lucide-react'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Spinner } from '../../components/ui/Spinner'
import { Textarea } from '../../components/ui/Textarea'
import { useAdminToast } from '../../components/admin/AdminLayout'
import { getSettings, updateSettings } from '../../lib/api-admin'
import type { SettingsMap } from '../../lib/api-public'
import { withBasePath } from '../../lib/constants'

type Tab = 'system' | 'discord'

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
  const [tab, setTab] = useState<Tab>('system')
  const [settings, setSettings] = useState<SettingsMap>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState<Record<Tab, boolean>>({ system: false, discord: false })
  const [form, setForm] = useState({
    applications_open: true,
    closed_message: '',
    rate_limit_per_ip_per_hour: 5,
    site_title: 'Luminacraft Staff Center',
    discord_enabled: false,
  })
  const notify = useAdminToast()

  useEffect(() => {
    let active = true
    setLoading(true)
    getSettings()
      .then((data) => {
        if (!active) return
        setSettings(data)
        setForm({
          applications_open: asBool(data.applications_open, true),
          closed_message: asText(
            data.closed_message,
            'Başvurular şu anda kapalı. Yeni duyurular için bizi takip edin.',
          ),
          rate_limit_per_ip_per_hour: asNumber(data.rate_limit_per_ip_per_hour, 5),
          site_title: asText(data.site_title, 'Luminacraft Staff Center'),
          discord_enabled: asBool(data.discord_enabled, false),
        })
        setDirty({ system: false, discord: false })
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
    setDirty((current) => ({ ...current, [key === 'discord_enabled' ? 'discord' : 'system']: true }))
  }

  const handleSaveSystem = async (event: FormEvent) => {
    event.preventDefault()
    if (form.rate_limit_per_ip_per_hour < 1 || form.rate_limit_per_ip_per_hour > 1000) {
      notify('Hız sınırı 1 ile 1000 arasında olmalıdır.', 'error')
      return
    }
    setSaving(true)
    try {
      const next = await updateSettings({
        applications_open: form.applications_open,
        closed_message: form.closed_message,
        rate_limit_per_ip_per_hour: form.rate_limit_per_ip_per_hour,
        site_title: form.site_title,
      })
      setSettings(next)
      setDirty((current) => ({ ...current, system: false }))
      notify('Sistem ayarları kaydedildi.', 'success')
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Ayarlar kaydedilemedi.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveDiscord = async () => {
    setSaving(true)
    try {
      const next = await updateSettings({ discord_enabled: form.discord_enabled })
      setSettings(next)
      setDirty((current) => ({ ...current, discord: false }))
      notify('Discord ayarı kaydedildi.', 'success')
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Discord ayarı kaydedilemedi.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const clientId = String(import.meta.env.VITE_DISCORD_CLIENT_ID ?? '').trim()
  const redirectUri =
    typeof window === 'undefined'
      ? ''
      : `${window.location.origin}${withBasePath('/admin/login')}`

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-black text-white">Ayarlar</h1>
          <p className="mt-1 text-sm text-slate-400">
            Başvuru akışını, hız sınırlarını ve Discord entegrasyonunu yönetin.
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

      <div className="flex gap-2 border-b border-white/10" role="tablist" aria-label="Ayar kategorileri">
        {([
          { key: 'system', label: 'Sistem', icon: Settings2 },
          { key: 'discord', label: 'Discord', icon: Globe2 },
        ] as const).map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              onClick={() => setTab(item.key)}
              className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
                tab === item.key
                  ? 'border-emerald-400 text-emerald-200'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              <Icon size={16} /> {item.label}
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="flex min-h-[300px] flex-col items-center justify-center gap-3" role="status">
          <Spinner size={30} />
          <p className="text-sm text-slate-400">Ayarlar yükleniyor...</p>
        </div>
      ) : tab === 'system' ? (
        <form onSubmit={handleSaveSystem} className="space-y-5">
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
              {dirty.system ? 'Kaydedilmemiş değişiklikler var.' : 'Tüm ayarlar güncel.'}
            </p>
            <Button type="submit" loading={saving} disabled={!dirty.system} icon={<Save size={16} />}>
              Sistem ayarlarını kaydet
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-5">
          <Card title="Discord entegrasyonu" description="Karar bildirimleri Discord özel mesajlarıyla gönderilir.">
            <div className="space-y-4">
              <Switch
                label="Discord bildirimleri etkin"
                hint="Kabul/red kararlarında bildirim kuyruğu oluşturulur."
                checked={form.discord_enabled}
                onChange={(value) => change('discord_enabled', value)}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-white/5 bg-black/20 p-4">
                  <p className="text-xs uppercase tracking-wider text-slate-500">Uygulama kimliği</p>
                  <p className="mt-1 break-all font-mono text-sm text-slate-200">
                    {clientId || 'Tarayıcıda tanımlı değil'}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    OAuth kimliği genel bilgidir; gizli anahtar asla gösterilmez.
                  </p>
                </div>
                <div className="rounded-lg border border-white/5 bg-black/20 p-4">
                  <p className="text-xs uppercase tracking-wider text-slate-500">Yönlendirme URI</p>
                  <p className="mt-1 break-all font-mono text-sm text-slate-200">
                    {redirectUri || '—'}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    Discord Developer Portal &gt; OAuth2 &gt; Redirects alanına ekleyin.
                  </p>
                </div>
              </div>
            </div>
          </Card>

          <div className="rounded-xl border border-amber-400/25 bg-amber-400/5 p-5">
            <p className="flex items-center gap-2 font-semibold text-amber-100">
              <AlertTriangle size={18} /> Gizli anahtarlar bu panelde yönetilmez
            </p>
            <p className="mt-2 text-sm leading-relaxed text-amber-200/80">
              <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-xs">DISCORD_BOT_TOKEN</code>,{' '}
              <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-xs">DISCORD_CLIENT_SECRET</code> ve{' '}
              <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-xs">SESSION_SECRET</code>{' '}
              yalnızca Edge Function ortamında tanımlanan sırlardır. Bu sayfada görüntülenmez,
              düzenlenmez veya tarayıcıya gönderilmez.
            </p>
          </div>

          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <KeyRound size={14} /> Yapılandırma değişiklikleri denetim kaydına yazılır.
            </p>
            <Button onClick={handleSaveDiscord} loading={saving} disabled={!dirty.discord} icon={<Save size={16} />}>
              Discord ayarını kaydet
            </Button>
          </div>

          <p className="flex items-center gap-2 text-xs text-slate-500">
            <ShieldCheck size={14} className="text-emerald-300" />
            Başvuruya bağlı Discord hesabı yoksa bildirim "başarısız" olarak işaretlenir; karar
            etkilenmez.
            <Badge variant="info" className="ml-1">Discord</Badge>
            <ExternalLink size={13} />
          </p>
        </div>
      )}
    </div>
  )
}
