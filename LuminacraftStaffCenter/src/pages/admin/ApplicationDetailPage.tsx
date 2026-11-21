import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  BellRing,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Hash,
  MessageCircle,
  MapPin,
  RotateCcw,
  UserRound,
} from 'lucide-react'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { Textarea } from '../../components/ui/Textarea'
import AuditTimeline from '../../components/admin/AuditTimeline'
import ScorePanel from '../../components/admin/ScorePanel'
import { useAdminToast } from '../../components/admin/AdminLayout'
import {
  getApplication,
  listNotifications,
  listQuestions,
  retryNotification,
  sendNotification,
  updateApplicationStatus,
} from '../../lib/api-admin'
import { APPLICATION_STATUSES, POSITIONS, QUESTION_CATEGORIES } from '../../lib/constants'
import { formatAnswerValue, statusLabel } from '../../lib/scoring'
import { cn, formatDateTime } from '../../lib/utils'
import type {
  Application,
  ApplicationAnswer,
  ApplicationHistory,
  ApplicationNote,
  ApplicationScore,
  ApplicationStatus,
  DiscordNotification,
  Question,
} from '../../types'

interface DetailState {
  application: Application
  answers: ApplicationAnswer[]
  scores: ApplicationScore[]
  notes: ApplicationNote[]
  history: ApplicationHistory[]
}

const CATEGORY_IDS = QUESTION_CATEGORIES.map((_, index) =>
  `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
)

function categoryLabel(id: string | null | undefined): string {
  if (!id) return 'Genel'
  const index = CATEGORY_IDS.indexOf(id)
  return index >= 0 ? QUESTION_CATEGORIES[index].label : 'Diğer kategori'
}

function answerText(answer: ApplicationAnswer): string {
  return formatAnswerValue(answer.value)
}

function notificationLabel(status: string | null | undefined): string {
  if (status === 'sent') return 'Gönderildi'
  if (status === 'failed') return 'Başarısız'
  if (status === 'pending') return 'Gönderim sırada'
  return 'Bildirim yok'
}

export default function ApplicationDetailPage() {
  const { id = '' } = useParams()
  const [detail, setDetail] = useState<DetailState | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [notifications, setNotifications] = useState<DiscordNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pendingStatus, setPendingStatus] = useState<ApplicationStatus | null>(null)
  const [decisionNote, setDecisionNote] = useState('')
  const [savingDecision, setSavingDecision] = useState(false)
  const [sendingNotification, setSendingNotification] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const notify = useAdminToast()

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([
      getApplication(id),
      listQuestions().catch(() => [] as Question[]),
      listNotifications(id).catch(() => [] as DiscordNotification[]),
    ])
      .then(([applicationDetail, questionList, notificationList]) => {
        if (!active) return
        setDetail(applicationDetail)
        setQuestions(questionList)
        setNotifications(notificationList)
        setError('')
      })
      .catch((caught) => {
        if (!active) return
        const message = caught instanceof Error ? caught.message : 'Başvuru yüklenemedi.'
        setError(message)
        notify(message, 'error')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [id, reloadKey, notify])

  const questionMap = useMemo(
    () => new Map(questions.map((question) => [question.id, question])),
    [questions],
  )

  const reload = () => setReloadKey((key) => key + 1)

  const handleStatusConfirm = async () => {
    if (!pendingStatus || !detail) return
    setSavingDecision(true)
    try {
      const result = await updateApplicationStatus(detail.application.id, pendingStatus, decisionNote)
      setDetail((current) => (current ? { ...current, application: result.application } : current))
      notify(`Durum "${statusLabel(pendingStatus)}" olarak güncellendi.`, 'success')
      setPendingStatus(null)
      setDecisionNote('')
      reload()
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Durum güncellenemedi.', 'error')
    } finally {
      setSavingDecision(false)
    }
  }

  const handleNotification = async () => {
    if (!detail) return
    // Yalnızca gerçekten başarısız bildirimler yeniden gönderilebilir; bekleyen/gönderilen
    // bir kaydı retry etmek Edge Function tarafından invalid_state ile reddedilir.
    const failedNotifications = notifications.filter((item) => item.status === 'failed')
    const lastFailed = failedNotifications[0]
    const isRetry = Boolean(lastFailed)
    setSendingNotification(true)
    try {
      const result = lastFailed
        ? await retryNotification(lastFailed.id)
        : await sendNotification(detail.application.id)
      if (result.notification_status === 'failed' && result.error) {
        notify(result.error, 'error')
      } else {
        notify(isRetry ? 'Bildirim yeniden gönderildi.' : 'Bildirim gönderildi.', 'success')
      }
      reload()
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Bildirim gönderilemedi.', 'error')
    } finally {
      setSendingNotification(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3" role="status">
        <Spinner size={32} />
        <p className="text-sm text-slate-400">Başvuru detayları yükleniyor...</p>
      </div>
    )
  }

  if (!detail) {
    return (
      <Card title="Başvuru bulunamadı">
        <p role="alert" className="text-sm text-red-300">{error || 'Kayıt görüntülenemedi.'}</p>
        <Link to="/admin/applications" className="mt-4 inline-block">
          <Button variant="secondary" icon={<ArrowLeft size={16} />}>Başvurulara dön</Button>
        </Link>
      </Card>
    )
  }

  const { application, answers, scores, notes, history } = detail
  const notificationStatus = application.notification_status
  const hasDiscord = Boolean(application.discord_user_id || application.applicant_discord_username)
  const decided = application.status === 'accepted' || application.status === 'rejected'

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Link to="/admin/applications" className="mt-1 text-slate-400 hover:text-white" aria-label="Başvurulara dön">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-black text-white">Başvuru detayı</h1>
              <Badge variant={application.status}>{statusLabel(application.status)}</Badge>
            </div>
            <p className="mt-1 font-mono text-sm text-emerald-300">{application.tracking_no}</p>
          </div>
        </div>
        <Button
          variant="secondary"
          icon={<ClipboardList size={16} />}
          onClick={() => {
            void navigator.clipboard?.writeText(application.tracking_no)
            notify('Takip numarası kopyalandı.', 'success')
          }}
        >
          Takip noyu kopyala
        </Button>
      </header>

      <section className="grid gap-5 lg:grid-cols-3">
        <Card title="Başvuran" description="Kişisel ve Discord bilgileri">
          <dl className="space-y-3 text-sm">
            <div className="flex items-start gap-3">
              <UserRound size={16} className="mt-0.5 shrink-0 text-cyan-300" />
              <div><dt className="text-xs text-slate-500">Minecraft adı</dt><dd className="font-semibold text-slate-100">{application.applicant_minecraft_username}</dd></div>
            </div>
            <div className="flex items-start gap-3">
              <MessageCircle size={16} className="mt-0.5 shrink-0 text-cyan-300" />
              <div>
                <dt className="text-xs text-slate-500">Discord bağlantısı</dt>
                <dd className="text-slate-100">
                  {application.applicant_discord_username || 'Belirtilmedi'}
                  {application.discord_connected ? ' · bağlı' : ''}
                </dd>
              </div>
            </div>
            <div className="pt-1">
              <Badge variant={hasDiscord ? 'success' : 'warning'}>
                {hasDiscord ? 'Discord hesabı bağlı' : 'Discord hesabı bulunamadı'}
              </Badge>
            </div>
          </dl>
        </Card>

        <Card title="Başvuru bilgileri" description="Pozisyon ve tarihçe">
          <dl className="space-y-3 text-sm">
            <div className="flex items-start gap-3">
              <MapPin size={16} className="mt-0.5 shrink-0 text-emerald-300" />
              <div>
                <dt className="text-xs text-slate-500">Pozisyon</dt>
                <dd className="font-semibold text-slate-100">
                  {POSITIONS.find((item) => item.slug === application.position_slug)?.label ?? application.position_slug}
                </dd>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CalendarDays size={16} className="mt-0.5 shrink-0 text-emerald-300" />
              <div>
                <dt className="text-xs text-slate-500">Gönderim tarihi</dt>
                <dd className="text-slate-100">{formatDateTime(application.submitted_at)}</dd>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Hash size={16} className="mt-0.5 shrink-0 text-emerald-300" />
              <div>
                <dt className="text-xs text-slate-500">Son güncelleme</dt>
                <dd className="text-slate-100">{formatDateTime(application.updated_at)}</dd>
              </div>
            </div>
          </dl>
        </Card>

        <Card title="Karar ve bildirim" description="Durumu değiştirin, Discord sonucunu izleyin">
          <div className="flex flex-wrap gap-2">
            {APPLICATION_STATUSES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  if (option.value !== application.status) {
                    setDecisionNote('')
                    setPendingStatus(option.value)
                  }
                }}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors',
                  option.value === application.status
                    ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-200'
                    : 'border-white/10 bg-white/5 text-slate-300 hover:border-emerald-400/30 hover:text-white',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="mt-5 rounded-lg border border-white/5 bg-black/20 p-3">
            <p className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500">
              <BellRing size={14} /> Discord bildirimi
            </p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <Badge
                variant={
                  notificationStatus === 'sent'
                    ? 'success'
                    : notificationStatus === 'failed'
                      ? 'danger'
                      : notificationStatus === 'pending'
                        ? 'pending'
                        : 'default'
                }
              >
                {notificationLabel(notificationStatus)}
              </Badge>
              {decided && notificationStatus !== 'sent' && (
                <Button
                  variant="secondary"
                  icon={<RotateCcw size={14} />}
                  loading={sendingNotification}
                  onClick={handleNotification}
                >
                  Yeniden gönder
                </Button>
              )}
            </div>
            {notifications.find((item) => item.last_error)?.last_error && (
              <p className="mt-2 text-xs text-red-300">
                {notifications.find((item) => item.last_error)?.last_error}
              </p>
            )}
          </div>
        </Card>
      </section>

      <Card
        title="Cevaplar"
        description="Başvuru anındaki soru metinleri ve verilen cevaplar (silinen soruların anlık görüntüleri dahil)."
      >
        {answers.length === 0 ? (
          <p className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-500">
            Kayıtlı cevap bulunamadı.
          </p>
        ) : (
          <ul className="space-y-3">
            {answers.map((answer, index) => {
              const question = questionMap.get(answer.question_id)
              return (
                <li key={answer.id ?? `${answer.question_id}-${index}`} className="rounded-lg border border-white/5 bg-black/20 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-mono text-slate-600">#{index + 1}</span>
                    <p className="flex-1 text-sm font-semibold text-slate-100">
                      {answer.question_text ?? question?.question_text ?? 'Silinmiş soru'}
                    </p>
                    <Badge variant="default">{categoryLabel(question?.category_id)}</Badge>
                    {answer.question_type && <Badge variant="info">{answer.question_type}</Badge>}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-emerald-100/90">
                    {answerText(answer)}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <ScorePanel
          applicationId={application.id}
          scores={scores}
          notes={notes}
          onScoresSaved={reload}
          onNoteAdded={reload}
        />
        <Card title="İşlem geçmişi" description="Durum değişiklikleri ve denetim kayıtları">
          <AuditTimeline entries={history} />
        </Card>
      </div>

      <Modal
        open={pendingStatus !== null}
        onClose={() => setPendingStatus(null)}
        title="Durumu değiştir"
        description={`Başvuruyu "${pendingStatus ? statusLabel(pendingStatus) : ''}" olarak işaretlemek üzeresiniz.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingStatus(null)}>Vazgeç</Button>
            <Button
              variant={pendingStatus === 'rejected' ? 'danger' : 'primary'}
              loading={savingDecision}
              icon={<CheckCircle2 size={16} />}
              onClick={handleStatusConfirm}
            >
              Değişikliği onayla
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          Bu işlem denetim kaydına yazılır.
          {pendingStatus === 'accepted' || pendingStatus === 'rejected'
            ? ' Karar sonrası Discord bildirimi otomatik olarak kuyruğa alınır.'
            : ''}
        </p>
        <div className="mt-4">
          <Textarea
            label="Karar notu (isteğe bağlı)"
            rows={3}
            maxLength={1000}
            value={decisionNote}
            placeholder="Karar gerekçenizi yazın; ekip kayıtlarına iç not olarak işlenir. Discord açıksa başvurana geri bildirim olarak iletilir."
            onChange={(event) => setDecisionNote(event.target.value)}
          />
        </div>
      </Modal>
    </div>
  )
}
