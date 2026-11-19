import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  Clipboard,
  ClipboardCheck,
  Clock3,
  Copy,
  Gamepad2,
  Gift,
  Link2,
  LockKeyhole,
  MessageCircle,
  Send,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { ApplicationSummary } from '../components/public/ApplicationSummary'
import { ProgressStepper } from '../components/public/ProgressStepper'
import { QuestionRenderer } from '../components/public/QuestionRenderer'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { Textarea } from '../components/ui/Textarea'
import {
  NOT_CONFIGURED_MESSAGE,
  areApplicationsOpen,
  computeElapsedMs,
  getClosedMessage,
  getDiscordOAuthUrl,
  getQuestionOptions,
  getQuestions,
  getSettings,
  groupQuestions,
  isHoneypotFilled,
  submitApplication,
  type PublicApiErrorLike,
  type PublicQuestion,
  type SettingsMap,
} from '../lib/api-public'
import { POSITIONS } from '../lib/constants'
import { isAnswerValid } from '../lib/utils'

interface ApplicantState {
  minecraft_username: string
  discord_username: string
  age: string
  daily_activity: string
  minecraft_experience: string
  staff_experience: string
  self_introduction: string
}

const EMPTY_APPLICANT: ApplicantState = {
  minecraft_username: '',
  discord_username: '',
  age: '',
  daily_activity: '',
  minecraft_experience: '',
  staff_experience: '',
  self_introduction: '',
}

const ACTIVITY_OPTIONS = [
  { value: 'her_gun', label: 'Her gün' },
  { value: 'haftada_birkaç', label: 'Haftada birkaç kez' },
  { value: 'haftada_bir', label: 'Haftada bir' },
  { value: 'nadir', label: 'Daha seyrek' },
]

const ACTIVITY_LABELS: Record<string, string> = Object.fromEntries(
  ACTIVITY_OPTIONS.map((option) => [option.value, option.label]),
)

type Errors = Record<string, string>

function errorFromUnknown(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  return message.trim() || 'İşlem tamamlanamadı. Lütfen tekrar deneyin.'
}

function generalErrors(applicant: ApplicantState): Errors {
  const errors: Errors = {}
  const minecraft = applicant.minecraft_username.trim()
  if (!isAnswerValid('short_text', minecraft, { required: true })) {
    errors.minecraft_username = 'Minecraft kullanıcı adı zorunludur.'
  } else if (!/^[A-Za-z0-9_]{3,16}$/.test(minecraft)) {
    errors.minecraft_username = 'Kullanıcı adı 3–16 karakter olmalı ve yalnızca harf, sayı veya alt çizgi içermelidir.'
  }

  const discord = applicant.discord_username.trim()
  if (discord && !isAnswerValid('short_text', discord, { maxLength: 32 })) {
    errors.discord_username = 'Discord kullanıcı adı en fazla 32 karakter olabilir.'
  }

  const age = applicant.age === '' ? '' : Number(applicant.age)
  if (!isAnswerValid('number', age, { required: true, minLength: 16, maxLength: 99 })) {
    errors.age = 'Yaş alanı zorunludur ve 16 ile 99 arasında olmalıdır.'
  }

  if (!isAnswerValid('single_choice', applicant.daily_activity, {
    required: true,
    options: ACTIVITY_OPTIONS.map((option) => option.value),
  })) {
    errors.daily_activity = 'Lütfen günlük aktiflik düzeyinizi seçin.'
  }

  if (!isAnswerValid('short_text', applicant.minecraft_experience.trim(), {
    required: true,
    minLength: 10,
    maxLength: 500,
  })) {
    errors.minecraft_experience = 'Minecraft deneyiminizi 10–500 karakter arasında yazın.'
  }

  if (!isAnswerValid('short_text', applicant.staff_experience.trim(), {
    required: true,
    minLength: 3,
    maxLength: 500,
  })) {
    errors.staff_experience = 'Yetkili deneyiminizi kısaca yazın (deneyiminiz yoksa “Yok” yazabilirsiniz).'
  }

  if (!isAnswerValid('long_text', applicant.self_introduction.trim(), {
    required: true,
    minLength: 40,
    maxLength: 1500,
  })) {
    errors.self_introduction = 'Kendinizi 40–1500 karakter arasında tanıtın.'
  }

  return errors
}

function questionErrorMessage(question: PublicQuestion): string {
  if (question.type === 'single_choice' || question.type === 'multiple_choice') {
    return 'Lütfen geçerli bir seçenek işaretleyin.'
  }
  if (question.type === 'yes_no') return 'Lütfen Evet veya Hayır seçin.'
  if (question.type === 'checkbox') return 'Devam etmek için bu onayı işaretleyin.'
  if (question.type === 'number') {
    if (question.min_value != null && question.max_value != null) {
      return `Değer ${question.min_value} ile ${question.max_value} arasında olmalıdır.`
    }
    if (question.min_value != null) return `Değer en az ${question.min_value} olmalıdır.`
    if (question.max_value != null) return `Değer en fazla ${question.max_value} olabilir.`
    return 'Geçerli bir sayı girin.'
  }
  if (question.min_length != null && question.max_length != null) {
    return `Cevap ${question.min_length}–${question.max_length} karakter arasında olmalıdır.`
  }
  if (question.min_length != null) return `Cevap en az ${question.min_length} karakter olmalıdır.`
  if (question.max_length != null) return `Cevap en fazla ${question.max_length} karakter olabilir.`
  return question.is_required ? 'Bu soruyu yanıtlamanız zorunludur.' : 'Geçerli bir cevap girin.'
}

function questionErrors(questions: PublicQuestion[], answers: Record<string, unknown>): Errors {
  const errors: Errors = {}
  for (const question of questions) {
    const value = answers[question.id] ?? ''
    const isNumber = question.type === 'number'
    const valid = isAnswerValid(question.type, value, {
      required: question.is_required,
      minLength: isNumber ? (question.min_value ?? undefined) : (question.min_length ?? undefined),
      maxLength: isNumber ? (question.max_value ?? undefined) : (question.max_length ?? undefined),
      options: getQuestionOptions(question).map((option) => option.value),
    })
    if (!valid) errors[question.id] = questionErrorMessage(question)
  }
  return errors
}

function Field({
  name,
  label,
  children,
}: {
  name: string
  label: string
  children: ReactNode
}) {
  return (
    <div data-field={name} className="min-w-0">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}

export function ApplyPage() {
  const { position: positionParam } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const position = POSITIONS.find((item) => item.slug === positionParam)
  const mountedAt = useRef(Date.now())
  const formRef = useRef<HTMLFormElement>(null)

  const [applicant, setApplicant] = useState<ApplicantState>(EMPTY_APPLICANT)
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [errors, setErrors] = useState<Errors>({})
  const [website, setWebsite] = useState('')
  const [questions, setQuestions] = useState<PublicQuestion[]>([])
  const [settings, setSettings] = useState<SettingsMap>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [unconfigured, setUnconfigured] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [completedSteps, setCompletedSteps] = useState<number[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [submission, setSubmission] = useState<{ tracking_no: string; query_token: string } | null>(null)
  const [discordLinked, setDiscordLinked] = useState(false)
  const [copied, setCopied] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (params.get('discord') !== 'linked') return
    const username = params.get('username') ?? ''
    if (username) {
      setApplicant((previous) => ({ ...previous, discord_username: username }))
    }
    setDiscordLinked(true)
    if (location.search) navigate(`${location.pathname}${location.hash}`, { replace: true })
  }, [location.search, location.pathname, location.hash, navigate])

  useEffect(() => {
    if (!position) return
    let active = true
    async function load() {
      setLoading(true)
      const [questionsResult, settingsResult] = await Promise.allSettled([
        getQuestions(position!.slug),
        getSettings(),
      ])
      if (!active) return
      if (
        questionsResult.status === 'rejected' &&
        (questionsResult.reason as PublicApiErrorLike | undefined)?.code === 'NOT_CONFIGURED'
      ) {
        setUnconfigured(true)
        setLoading(false)
        return
      }
      if (questionsResult.status === 'fulfilled') setQuestions(questionsResult.value)
      else setLoadError('Başvuru soruları yüklenemedi. Lütfen sayfayı yenileyip tekrar deneyin.')
      if (settingsResult.status === 'fulfilled') setSettings(settingsResult.value)
      setLoading(false)
    }
    void load()
    return () => {
      active = false
    }
  }, [position?.slug])

  const groups = useMemo(() => groupQuestions(questions), [questions])
  const steps = useMemo(
    () => ['Genel bilgiler', ...groups.map((group) => group.name), 'Önizleme ve gönderim'],
    [groups],
  )
  const reviewStep = steps.length - 1
  const percentage = steps.length > 1 ? Math.round((currentStep / (steps.length - 1)) * 100) : 0

  function updateApplicant(key: keyof ApplicantState, value: string) {
    setApplicant((previous) => ({ ...previous, [key]: value }))
    setErrors((previous) => {
      if (!previous[key as string]) return previous
      const next = { ...previous }
      delete next[key as string]
      return next
    })
  }

  function updateAnswer(questionId: string, value: unknown) {
    setAnswers((previous) => ({ ...previous, [questionId]: value }))
    setErrors((previous) => {
      if (!previous[questionId]) return previous
      const next = { ...previous }
      delete next[questionId]
      return next
    })
  }

  function focusField(key: string) {
    const root = formRef.current
    if (!root) return
    const elements = Array.from(root.querySelectorAll<HTMLElement>('input, textarea, select'))
    const target = elements.find((element) => {
      const owner = element.closest('[data-field], [data-question-id]')
      return owner?.getAttribute('data-field') === key || owner?.getAttribute('data-question-id') === key
    })
    if (!target) return
    target.focus()
    if (typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }

  function goToTop() {
    if (typeof window.scrollTo === 'function') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleNext() {
    const stepErrors =
      currentStep === 0
        ? generalErrors(applicant)
        : currentStep <= groups.length
          ? questionErrors(groups[currentStep - 1]?.questions ?? [], answers)
          : {}
    const keys = Object.keys(stepErrors)
    if (keys.length > 0) {
      setErrors((previous) => ({ ...previous, ...stepErrors }))
      requestAnimationFrame(() => focusField(keys[0]))
      return
    }
    setErrors((previous) => {
      const next = { ...previous }
      for (const key of keys) delete next[key]
      return next
    })
    setCompletedSteps((previous) =>
      previous.includes(currentStep) ? previous : [...previous, currentStep],
    )
    setCurrentStep((previous) => Math.min(previous + 1, reviewStep))
    setSubmitError('')
    goToTop()
  }

  function handleBack() {
    setCurrentStep((previous) => Math.max(0, previous - 1))
    setSubmitError('')
    goToTop()
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!position || submitting) return

    const allErrors = { ...generalErrors(applicant), ...questionErrors(questions, answers) }
    const keys = Object.keys(allErrors)
    if (keys.length > 0) {
      setErrors(allErrors)
      const first = keys[0]
      if (first in EMPTY_APPLICANT) {
        setCurrentStep(0)
      } else {
        const groupIndex = groups.findIndex((group) =>
          group.questions.some((question) => question.id === first),
        )
        if (groupIndex >= 0) setCurrentStep(groupIndex + 1)
      }
      requestAnimationFrame(() => focusField(first))
      return
    }

    if (isHoneypotFilled(website)) {
      setSubmitError('Başvuru gönderilemedi. Lütfen tekrar deneyin.')
      return
    }

    setSubmitting(true)
    setSubmitError('')
    try {
      const result = await submitApplication({
        position_slug: position.slug,
        applicant: {
          ...applicant,
          age: Number(applicant.age),
          discord_linked: discordLinked,
        },
        answers,
        website,
        elapsed_ms: computeElapsedMs(mountedAt.current),
      })
      setSubmission(result)
      goToTop()
    } catch (error) {
      setSubmitError(errorFromUnknown(error))
    } finally {
      setSubmitting(false)
    }
  }

  async function copyValue(value: string, key: string) {
    try {
      if (!navigator.clipboard) throw new Error('Kopyalama desteklenmiyor')
      await navigator.clipboard.writeText(value)
      setCopied(key)
    } catch {
      setSubmitError('Kopyalanamadı. Değeri elle seçip kopyalayabilirsiniz.')
    }
  }

  const header = (
    <header className="border-b border-white/5 bg-obsidian-950/70 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2.5" aria-label="Luminacraft ana sayfa">
          <span className="flex h-9 w-9 items-center justify-center rounded-md border border-emerald-400/40 bg-emerald-400/10 font-mono text-lg font-bold text-emerald-350">L</span>
          <span className="leading-tight">
            <span className="block text-sm font-bold tracking-wide text-white">LUMINACRAFT</span>
            <span className="block font-mono text-[10px] tracking-[0.2em] text-emerald-350">STAFF CENTER</span>
          </span>
        </Link>
        <nav className="flex items-center gap-3 text-xs sm:text-sm" aria-label="Başvuru menüsü">
          <Link to="/status" className="text-slate-400 transition-colors hover:text-white">Başvuru durumum</Link>
          <Link to="/" className="rounded-md border border-white/10 px-3 py-2 text-slate-300 transition-colors hover:border-emerald-400/40 hover:text-white">
            Ana sayfa
          </Link>
        </nav>
      </div>
    </header>
  )

  if (!position) {
    return (
      <div className="pixel-grid min-h-screen">
        {header}
        <main className="mx-auto flex max-w-2xl flex-col items-center px-4 py-24 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-xl border border-amber-400/25 bg-amber-400/10 text-amber-300">
            <AlertTriangle size={30} aria-hidden="true" />
          </span>
          <h1 className="mt-6 text-3xl font-bold text-white">Pozisyon bulunamadı</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            “{positionParam || '—'}” adlı bir pozisyon kayıtlı değil. Başvuru yapmak için ana sayfadaki
            açık pozisyonları inceleyin.
          </p>
          <Link to="/" className="btn-minecraft mt-8">Ana sayfaya dön</Link>
        </main>
      </div>
    )
  }

  if (submission) {
    return (
      <div className="pixel-grid min-h-screen">
        {header}
        <main className="mx-auto max-w-2xl px-4 py-14 sm:px-6">
          <div className="panel glow-border animate-fade-up overflow-hidden">
            <div className="border-b border-white/5 px-6 py-8 text-center">
              <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-400/10 text-emerald-300">
                <CheckCircle2 size={34} aria-hidden="true" />
              </span>
              <Badge variant="success" className="mt-5">Başvuru alındı</Badge>
              <h1 className="mt-4 text-2xl font-bold text-white sm:text-3xl">Başvurun tamamlandı!</h1>
              <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-400">
                {position.name} pozisyonundaki başvurun güvenle kaydedildi. Aşağıdaki bilgileri
                kaydettiğinden emin ol.
              </p>
            </div>

            <div className="space-y-4 px-6 py-6">
              <div className="rounded-lg border border-emerald-400/25 bg-emerald-400/5 p-4">
                <p className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
                  <Clipboard size={14} aria-hidden="true" /> Başvuru numarası
                </p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <code className="break-all font-mono text-lg font-semibold text-white">{submission.tracking_no}</code>
                  <Button variant="secondary" onClick={() => void copyValue(submission.tracking_no, 'tracking')}>
                    {copied === 'tracking' ? <ClipboardCheck size={15} /> : <Copy size={15} />}
                    {copied === 'tracking' ? 'Kopyalandı' : 'Kopyala'}
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-cyan-350/25 bg-cyan-350/5 p-4">
                <p className="flex items-center gap-2 text-xs font-semibold text-cyan-300">
                  <ShieldCheck size={14} aria-hidden="true" /> Sorgu kodu
                </p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <code className="break-all font-mono text-sm text-white">{submission.query_token}</code>
                  <Button variant="secondary" onClick={() => void copyValue(submission.query_token, 'token')}>
                    {copied === 'token' ? <ClipboardCheck size={15} /> : <Copy size={15} />}
                    {copied === 'token' ? 'Kopyalandı' : 'Kopyala'}
                  </Button>
                </div>
              </div>

              <p role="alert" className="flex items-start gap-2.5 rounded-lg border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-sm leading-relaxed text-amber-100">
                <AlertTriangle size={17} className="mt-0.5 shrink-0 text-amber-300" aria-hidden="true" />
                <span><strong>Bu kodu kaydedin. Bu kodu kaybederseniz başvurunuzu sorgulayamazsınız.</strong> Sorgu kodu yalnızca size gösterilir; güvenli bir yere kaydedin.</span>
              </p>

              {submitError && (
                <p role="alert" className="text-sm text-red-300">{submitError}</p>
              )}

              <div className="flex flex-wrap gap-3 pt-2">
                <Link to="/status" className="btn-minecraft flex-1">Başvuru durumunu sorgula</Link>
                <Link to="/" className="inline-flex flex-1 items-center justify-center rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 hover:text-white">
                  Ana sayfaya dön
                </Link>
              </div>
            </div>
          </div>
        </main>
      </div>
    )
  }

  const closed = !loading && !unconfigured && !areApplicationsOpen(settings)

  return (
    <div className="pixel-grid min-h-screen">
      {header}
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="mb-7">
          <Badge variant="info" className="mb-3"><Sparkles size={13} aria-hidden="true" /> {position.name} başvurusu</Badge>
          <h1 className="text-3xl font-bold text-white sm:text-4xl">Ekibe katıl</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-400">
            Form birkaç adımdan oluşur. Cevaplarını dikkatle okuyup gönderimden önce önizleme
            ekranında kontrol edebilirsin.
          </p>
        </div>

        {loading ? (
          <div className="panel flex flex-col items-center gap-4 px-6 py-20 text-center" role="status" aria-live="polite">
            <Clock3 size={30} className="animate-pulse text-emerald-350" aria-hidden="true" />
            <p className="text-sm text-slate-400">Başvuru formu hazırlanıyor...</p>
          </div>
        ) : unconfigured ? (
          <div className="panel flex flex-col items-center px-6 py-16 text-center">
            <Clock3 size={32} className="text-emerald-350" aria-hidden="true" />
            <h2 className="mt-4 text-xl font-semibold text-white">Başvuru sistemi yakında</h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-400">{NOT_CONFIGURED_MESSAGE}</p>
            <Link to="/" className="btn-minecraft mt-6">Ana sayfaya dön</Link>
          </div>
        ) : closed ? (
          <div className="panel flex flex-col items-center px-6 py-16 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-xl border border-amber-400/25 bg-amber-400/10 text-amber-300">
              <LockKeyhole size={28} aria-hidden="true" />
            </span>
            <h2 className="mt-6 text-2xl font-semibold text-white">Başvurular şu anda kapalı</h2>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-slate-400">{getClosedMessage(settings)}</p>
            <Link to="/" className="btn-minecraft mt-7">Ana sayfaya dön</Link>
          </div>
        ) : (
          <>
            <ProgressStepper
              steps={steps}
              currentStep={currentStep}
              completedSteps={completedSteps}
              percentage={percentage}
            />

            <form ref={formRef} onSubmit={(event) => void handleSubmit(event)} noValidate className="mt-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-white">{steps[currentStep]}</h2>
                <span className="font-mono text-xs text-slate-500">{currentStep + 1}/{steps.length}</span>
              </div>

              {loadError && (
                <p role="alert" className="mb-4 rounded-lg border border-amber-400/25 bg-amber-400/5 px-4 py-3 text-sm text-amber-200">
                  {loadError}
                </p>
              )}

              {currentStep === 0 && (
                <section className="panel animate-fade-up space-y-5 p-5 sm:p-6">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field name="minecraft_username" label="Minecraft kullanıcı adı">
                      <Input
                        label="Minecraft kullanıcı adı"
                        required
                        autoComplete="nickname"
                        placeholder="Örn. LuminaCraft"
                        value={applicant.minecraft_username}
                        error={errors.minecraft_username}
                        onChange={(event) => updateApplicant('minecraft_username', event.target.value)}
                        suffix={<Gamepad2 size={15} aria-hidden="true" />}
                      />
                    </Field>

                    <Field name="discord_username" label="Discord kullanıcı adı">
                      <Input
                        label="Discord kullanıcı adı"
                        placeholder="Örn. luminacraft"
                        value={applicant.discord_username}
                        error={errors.discord_username}
                        onChange={(event) => updateApplicant('discord_username', event.target.value)}
                        suffix={<MessageCircle size={15} aria-hidden="true" />}
                      />
                    </Field>

                    <Field name="age" label="Yaş">
                      <Input
                        label="Yaş"
                        required
                        type="number"
                        inputMode="numeric"
                        min={16}
                        max={99}
                        placeholder="16"
                        value={applicant.age}
                        error={errors.age}
                        onChange={(event) => updateApplicant('age', event.target.value)}
                      />
                    </Field>

                    <Field name="daily_activity" label="Günlük aktiflik">
                      <Select
                        label="Günlük aktiflik"
                        required
                        placeholder="Seçiniz"
                        options={ACTIVITY_OPTIONS}
                        value={applicant.daily_activity}
                        error={errors.daily_activity}
                        onChange={(event) => updateApplicant('daily_activity', event.target.value)}
                      />
                    </Field>
                  </div>

                  <Field name="minecraft_experience" label="Minecraft deneyimi">
                    <Input
                      label="Minecraft deneyimi"
                      required
                      placeholder="Ne kadar süredir Minecraft oynuyorsun?"
                      value={applicant.minecraft_experience}
                      error={errors.minecraft_experience}
                      onChange={(event) => updateApplicant('minecraft_experience', event.target.value)}
                      hint="En az 10 karakter"
                    />
                  </Field>

                  <Field name="staff_experience" label="Yetkili deneyimi">
                    <Input
                      label="Yetkili deneyimi"
                      required
                      placeholder="Örn. Sunucuda 1 yıl rehberlik"
                      value={applicant.staff_experience}
                      error={errors.staff_experience}
                      onChange={(event) => updateApplicant('staff_experience', event.target.value)}
                      hint="Deneyiminiz yoksa “Yok” yazabilirsiniz."
                    />
                  </Field>

                  <Field name="self_introduction" label="Kendini tanıtma">
                    <Textarea
                      label="Kendini tanıtma"
                      required
                      rows={5}
                      maxLength={1500}
                      placeholder="Kendini, oyun tarzını ve ekibe nasıl katkı sağlayacağını anlat..."
                      value={applicant.self_introduction}
                      error={errors.self_introduction}
                      onChange={(event) => updateApplicant('self_introduction', event.target.value)}
                      hint="En az 40 karakter • Kendini tanıtman başvurunun değerlendirilmesinde önemli."
                    />
                  </Field>

                  <div className="flex flex-col gap-3 rounded-lg border border-cyan-350/20 bg-cyan-350/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                      <Link2 size={18} className="mt-0.5 shrink-0 text-cyan-300" aria-hidden="true" />
                      <div>
                        <p className="text-sm font-medium text-cyan-100">Discord hesabını bağla <span className="font-normal text-cyan-200/60">(isteğe bağlı)</span></p>
                        <p className="mt-1 text-xs leading-relaxed text-cyan-100/60">
                          Bağlamadan da başvurunu gönderebilirsin.
                        </p>
                      </div>
                    </div>
                    {discordLinked ? (
                      <Badge variant="success" className="shrink-0 self-start">
                        <BadgeCheck size={14} aria-hidden="true" />
                        Bağlandı {applicant.discord_username ? `· ${applicant.discord_username}` : ''}
                      </Badge>
                    ) : (
                      <a href={getDiscordOAuthUrl(location.pathname)} className="btn-minecraft shrink-0 self-start">
                        <Gift size={15} aria-hidden="true" />
                        Discord hesabını bağlan
                      </a>
                    )}
                  </div>
                </section>
              )}

              {currentStep > 0 && currentStep <= groups.length && (
                <section className="space-y-4">
                  <p className="text-sm leading-relaxed text-slate-400">
                    {groups[currentStep - 1]?.description || 'Soruları dikkatle okuyup cevaplarını girin.'}
                  </p>
                  {(groups[currentStep - 1]?.questions ?? []).map((question) => (
                    <QuestionRenderer
                      key={question.id}
                      question={question}
                      value={answers[question.id] ?? ''}
                      error={errors[question.id]}
                      onChange={(value) => updateAnswer(question.id, value)}
                    />
                  ))}
                  {questions.length === 0 && (
                    <div className="panel px-6 py-10 text-center text-sm text-slate-400">
                      Bu pozisyon için tanımlanmış ek soru bulunmuyor. Önizleme adımına devam edebilirsin.
                    </div>
                  )}
                </section>
              )}

              {currentStep === reviewStep && (
                <section>
                  <p className="mb-4 text-sm leading-relaxed text-slate-400">
                    Bilgilerini son kez kontrol et. Gönderimden sonra değiştirmek mümkün değildir.
                  </p>
                  <ApplicationSummary
                    positionName={position.name}
                    applicant={{
                      ...applicant,
                      daily_activity: ACTIVITY_LABELS[applicant.daily_activity] ?? applicant.daily_activity,
                    }}
                    questions={questions}
                    answers={answers}
                  />
                </section>
              )}

              <div aria-hidden="true" className="absolute -left-[10000px] top-0 h-px w-px overflow-hidden">
                <label htmlFor="website">Website alanını boş bırakın</label>
                <input
                  id="website"
                  name="website"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(event) => setWebsite(event.target.value)}
                />
              </div>

              {submitError && (
                <p role="alert" className="mt-5 flex items-start gap-2 rounded-lg border border-red-400/30 bg-red-400/5 px-4 py-3 text-sm text-red-200">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                  {submitError}
                </p>
              )}

              <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-6">
                <Button
                  variant="ghost"
                  onClick={handleBack}
                  disabled={currentStep === 0 || submitting}
                  icon={<ArrowLeft size={16} />}
                >
                  Geri
                </Button>
                {currentStep === reviewStep ? (
                  <Button
                    type="submit"
                    loading={submitting}
                    icon={submitting ? undefined : <Send size={16} />}
                    className="min-w-44"
                  >
                    {submitting ? 'Gönderiliyor...' : 'Başvuruyu gönder'}
                  </Button>
                ) : (
                  <Button onClick={handleNext} icon={<ArrowRight size={16} />} className="min-w-36">
                    Devam et
                  </Button>
                )}
              </div>
            </form>
          </>
        )}
      </main>
    </div>
  )
}

export default ApplyPage
