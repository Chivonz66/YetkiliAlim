import { useId, type ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Textarea'
import { cn } from '../../lib/utils'
import { getQuestionOptions } from '../../lib/api-public'
import type { Question, QuestionOption } from '../../types'

export interface QuestionRendererProps {
  question: Question
  value: unknown
  error?: string
  onChange: (v: unknown) => void
}

const AFFIRMATIVE = ['yes', 'true', 'evet', '1']
const NEGATIVE = ['no', 'false', 'hayır', 'hayir', '0']

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (AFFIRMATIVE.includes(normalized)) return true
  if (NEGATIVE.includes(normalized)) return false
  return null
}

function optionLabel(options: QuestionOption[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value
}

/** Cevabı başvuru önizlemesinde/sorgulama ekranında okunabilir metne çevirir (saf). */
export function answerToDisplayValue(question: Question, value: unknown): string {
  if (isEmpty(value)) return '—'
  const options = getQuestionOptions(question)

  switch (question.type) {
    case 'single_choice':
      return optionLabel(options, String(value))
    case 'multiple_choice': {
      const values = Array.isArray(value) ? value : [value]
      return values.map((item) => optionLabel(options, String(item))).join(', ')
    }
    case 'yes_no': {
      const boolean = toBoolean(value)
      if (boolean === true) return 'Evet'
      if (boolean === false) return 'Hayır'
      return String(value)
    }
    case 'checkbox':
      return toBoolean(value) === true ? 'Onaylandı' : 'Onaylanmadı'
    default:
      return String(value)
  }
}

function requiredMark(required: boolean) {
  if (!required) return null
  return (
    <span className="ml-1 text-emerald-350" aria-label="zorunlu" title="Zorunlu alan">
      *
    </span>
  )
}

function FieldMessage({
  id,
  error,
  children,
}: {
  id: string
  error?: string
  children?: ReactNode
}) {
  if (error) {
    return (
      <p id={id} role="alert" className="mt-2 flex items-start gap-1.5 text-xs text-red-300">
        <AlertCircle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>{error}</span>
      </p>
    )
  }
  if (!children) return null
  return (
    <p id={id} className="mt-1.5 text-xs leading-relaxed text-slate-500">
      {children}
    </p>
  )
}

export function QuestionRenderer({ question, value, error, onChange }: QuestionRendererProps) {
  const generatedId = useId()
  const fieldId = `question-${question.id}-${generatedId}`
  const helpId = `${fieldId}-help`
  const errorId = `${fieldId}-error`
  const options = getQuestionOptions(question)
  const describedBy = [question.help_text || hasHint(question) ? helpId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ')

  const sharedInputProps = {
    id: fieldId,
    name: `question-${question.id}`,
    'aria-invalid': Boolean(error),
    'aria-describedby': describedBy || undefined,
    'data-question-id': question.id,
  }

  // Grup inputları label içinde yer alır; yinelenen id kullanılmaz.
  const { id: _groupId, ...groupInputProps } = sharedInputProps

  const hints = () => {
    if (question.type === 'number') {
      if (question.min_value == null && question.max_value == null) return null
      if (question.min_value != null && question.max_value != null) {
        return `İzin verilen aralık: ${question.min_value} – ${question.max_value}`
      }
      return question.min_value != null
        ? `En küçük değer: ${question.min_value}`
        : `En büyük değer: ${question.max_value}`
    }
    if (question.type === 'short_text' || question.type === 'long_text') {
      if (question.min_length == null && question.max_length == null) return null
      if (question.min_length != null && question.max_length != null) {
        return `En az ${question.min_length}, en fazla ${question.max_length} karakter`
      }
      return question.min_length != null
        ? `En az ${question.min_length} karakter`
        : `En fazla ${question.max_length} karakter`
    }
    return null
  }

  const groupClasses = 'mt-3 grid gap-2 sm:grid-cols-2'
  const optionClasses =
    'flex cursor-pointer items-center gap-3 rounded-md border border-white/10 bg-obsidian-900/60 px-3 py-2.5 text-sm text-slate-300 transition-colors hover:border-emerald-400/40 hover:bg-emerald-400/5 has-[:checked]:border-emerald-400/50 has-[:checked]:bg-emerald-400/10 has-[:checked]:text-emerald-100'

  return (
    <div
      data-question-id={question.id}
      className="animate-fade-up rounded-lg border border-white/5 bg-obsidian-900/40 p-4 transition-colors hover:border-emerald-400/15 sm:p-5"
    >
      {question.type === 'single_choice' ||
      question.type === 'multiple_choice' ||
      question.type === 'yes_no' ? (
        <fieldset aria-describedby={describedBy || undefined}>
          <legend className="text-sm font-medium leading-relaxed text-slate-200">
            {question.question_text}
            {requiredMark(question.is_required)}
          </legend>

          {question.help_text && <p className="mt-1 text-xs text-slate-500">{question.help_text}</p>}
          {hints() && <p id={helpId} className="mt-1 text-xs text-slate-500">{hints()}</p>}

          {question.type === 'yes_no' ? (
            <div className={groupClasses}>
              {[
                { label: 'Evet', checked: true },
                { label: 'Hayır', checked: false },
              ].map((choice) => (
                <label key={choice.label} className={optionClasses}>
                  <input
                    {...groupInputProps}
                    type="radio"
                    value={choice.checked ? 'yes' : 'no'}
                    checked={toBoolean(value) === choice.checked}
                    onChange={() => onChange(choice.checked)}
                    className="h-4 w-4 shrink-0 accent-emerald-400"
                  />
                  <span>{choice.label}</span>
                </label>
              ))}
            </div>
          ) : options.length === 0 ? (
            <p className="mt-3 rounded-md border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">
              Bu soru için henüz seçenek tanımlanmadı.
            </p>
          ) : (
            <div className={groupClasses}>
              {options.map((option) => {
                const selected = Array.isArray(value)
                  ? value.some((item) => String(item) === option.value)
                  : String(value ?? '') === option.value
                return (
                  <label key={option.value} className={optionClasses}>
                    <input
                      {...groupInputProps}
                      type={question.type === 'multiple_choice' ? 'checkbox' : 'radio'}
                      value={option.value}
                      checked={selected}
                      onChange={() => {
                        if (question.type === 'multiple_choice') {
                          const current = Array.isArray(value) ? value.map(String) : []
                          onChange(
                            current.includes(option.value)
                              ? current.filter((item) => item !== option.value)
                              : [...current, option.value],
                          )
                        } else {
                          onChange(option.value)
                        }
                      }}
                      className="h-4 w-4 shrink-0 accent-emerald-400"
                    />
                    <span>{option.label}</span>
                  </label>
                )
              })}
            </div>
          )}
          <FieldMessage id={errorId} error={error} />
        </fieldset>
      ) : question.type === 'checkbox' ? (
        <div>
          <label
            htmlFor={fieldId}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-md border px-3 py-3 text-sm leading-relaxed transition-colors',
              value === true
                ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-100'
                : 'border-white/10 bg-obsidian-900/60 text-slate-300 hover:border-emerald-400/35',
            )}
          >
            <input
              {...sharedInputProps}
              type="checkbox"
              checked={value === true}
              onChange={(event) => onChange(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-400"
            />
            <span>
              {question.question_text}
              {requiredMark(question.is_required)}
            </span>
          </label>
          {question.help_text && <p className="mt-1.5 text-xs text-slate-500">{question.help_text}</p>}
          {hints() && <p id={helpId} className="mt-1 text-xs text-slate-500">{hints()}</p>}
          <FieldMessage id={errorId} error={error} />
        </div>
      ) : (
        <div>
          <label htmlFor={fieldId} className="block text-sm font-medium leading-relaxed text-slate-200">
            {question.question_text}
            {requiredMark(question.is_required)}
          </label>
          {question.help_text && <p className="mt-1 text-xs text-slate-500">{question.help_text}</p>}
          {hints() && <p id={helpId} className="mt-1 text-xs text-slate-500">{hints()}</p>}

          <div className="mt-3">
            {question.type === 'long_text' ? (
              <Textarea
                {...sharedInputProps}
                rows={4}
                value={typeof value === 'string' ? value : ''}
                onChange={(event) => onChange(event.target.value)}
                placeholder="Açıklamanızı buraya yazın..."
                maxLength={question.max_length ?? undefined}
              />
            ) : (
              <Input
                {...sharedInputProps}
                type={question.type === 'number' ? 'number' : 'text'}
                min={question.type === 'number' ? (question.min_value ?? undefined) : undefined}
                max={question.type === 'number' ? (question.max_value ?? undefined) : undefined}
                maxLength={question.type === 'short_text' ? (question.max_length ?? undefined) : undefined}
                value={
                  question.type === 'number'
                    ? value === null || value === undefined
                      ? ''
                      : String(value)
                    : typeof value === 'string'
                      ? value
                      : ''
                }
                onChange={(event) => {
                  if (question.type === 'number') {
                    onChange(event.target.value === '' ? '' : Number(event.target.value))
                  } else {
                    onChange(event.target.value)
                  }
                }}
                placeholder={question.type === 'number' ? 'Sayı girin' : 'Cevabınızı yazın...'}
              />
            )}
          </div>

          {(question.type === 'short_text' || question.type === 'long_text') && question.max_length != null && (
            <p className="mt-1 text-right font-mono text-[11px] text-slate-500" aria-live="polite">
              {typeof value === 'string' ? value.length : 0} / {question.max_length} karakter
            </p>
          )}
          <FieldMessage id={errorId} error={error} />
        </div>
      )}
    </div>
  )
}

function hasHint(question: Question): boolean {
  if (question.type === 'number') return question.min_value != null || question.max_value != null
  if (question.type === 'short_text' || question.type === 'long_text') {
    return question.min_length != null || question.max_length != null
  }
  return false
}

export default QuestionRenderer
