import { FileCheck2, UserRound } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { answerToDisplayValue } from './QuestionRenderer'
import { groupQuestions, type PublicQuestion } from '../../lib/api-public'

export interface ApplicantSummaryData {
  [key: string]: unknown
}

export interface ApplicationSummaryProps {
  positionName: string
  applicant: ApplicantSummaryData
  questions: PublicQuestion[]
  answers: Record<string, unknown>
}

const APPLICANT_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'minecraft_username', label: 'Minecraft kullanıcı adı' },
  { key: 'discord_username', label: 'Discord kullanıcı adı' },
  { key: 'age', label: 'Yaş' },
  { key: 'daily_activity', label: 'Günlük aktiflik' },
  { key: 'minecraft_experience', label: 'Minecraft deneyimi' },
  { key: 'staff_experience', label: 'Yetkili deneyimi' },
  { key: 'self_introduction', label: 'Kendini tanıtma' },
]

function readable(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Evet' : 'Hayır'
  if (Array.isArray(value)) return value.length ? value.map(String).join(', ') : '—'
  const text = String(value).trim()
  return text || '—'
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 border-b border-white/5 py-2.5 last:border-0 sm:grid-cols-[minmax(0,11rem)_1fr] sm:gap-4">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="break-words text-sm leading-relaxed text-slate-200">{value}</dd>
    </div>
  )
}

/** Son adımdaki salt-okunur başvuru önizlemesi. */
export function ApplicationSummary({
  positionName,
  applicant,
  questions,
  answers,
}: ApplicationSummaryProps) {
  const groups = groupQuestions(questions)

  return (
    <div className="space-y-4">
      <div className="panel animate-fade-up overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 px-5 py-4">
          <h3 className="flex items-center gap-2 text-base font-semibold text-white">
            <UserRound size={17} className="text-emerald-350" aria-hidden="true" />
            Genel bilgiler
          </h3>
          <Badge variant="info">{positionName}</Badge>
        </header>
        <dl className="px-5 py-2">
          {APPLICANT_FIELDS.map((field) => (
            <SummaryRow
              key={field.key}
              label={field.label}
              value={readable(applicant[field.key])}
            />
          ))}
        </dl>
      </div>

      {groups.map((group) => (
        <section key={group.id} className="panel animate-fade-up overflow-hidden">
          <header className="border-b border-white/5 px-5 py-3.5">
            <h3 className="text-sm font-semibold text-white">{group.name}</h3>
            {group.description && <p className="mt-1 text-xs text-slate-500">{group.description}</p>}
          </header>
          <dl className="px-5 py-2">
            {group.questions.map((question: PublicQuestion) => (
              <SummaryRow
                key={question.id}
                label={question.question_text}
                value={answerToDisplayValue(question, answers[question.id])}
              />
            ))}
          </dl>
        </section>
      ))}

      <div className="flex items-start gap-3 rounded-lg border border-cyan-350/20 bg-cyan-350/5 px-4 py-3 text-xs leading-relaxed text-cyan-100/80">
        <FileCheck2 size={16} className="mt-0.5 shrink-0 text-cyan-300" aria-hidden="true" />
        <p>
          Bilgilerinizi kontrol edin. Gönderimden sonra başvurunuzu yalnızca başvuru numarası ve
          sorgu kodu ile görüntüleyebilirsiniz.
        </p>
      </div>
    </div>
  )
}

export default ApplicationSummary
