import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Plus,
  Save,
  Trash2,
} from 'lucide-react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { Textarea } from '../ui/Textarea'
import {
  QUESTION_CATEGORIES,
  QUESTION_TYPES,
} from '../../lib/constants'
import type { QuestionPayload } from '../../lib/api-admin'
import type { Question, QuestionOption, QuestionType } from '../../types'

const KNOWN_CATEGORY_IDS: Record<string, string> = {
  general: '00000000-0000-4000-8000-000000000001',
  rehber: '00000000-0000-4000-8000-000000000002',
  aac: '00000000-0000-4000-8000-000000000003',
  experience: '00000000-0000-4000-8000-000000000004',
  scenario: '00000000-0000-4000-8000-000000000005',
}

const CHOICE_TYPES: QuestionType[] = ['single_choice', 'multiple_choice']
const TEXT_TYPES: QuestionType[] = ['short_text', 'long_text']

interface CategoryChoice {
  id: string
  label: string
}

interface OptionRow {
  label: string
  value: string
}

function buildCategories(questions: Question[]): CategoryChoice[] {
  const categories: CategoryChoice[] = QUESTION_CATEGORIES.map((category) => ({
    id: KNOWN_CATEGORY_IDS[category.slug] ?? category.slug,
    label: category.label,
  }))
  const seen = new Set(categories.map((item) => item.id))
  for (const question of questions) {
    const id = question.category_id
    if (id && !seen.has(id)) {
      seen.add(id)
      categories.push({ id, label: 'Diğer kategori' })
    }
  }
  return categories
}

function toOptionRows(options: QuestionOption[] | undefined): OptionRow[] {
  return (options ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((option) => ({ label: option.label, value: option.value }))
}

function emptyPayload(questions: Question[]): QuestionPayload {
  return {
    question_text: '',
    type: 'short_text',
    category_id: KNOWN_CATEGORY_IDS.general ?? null,
    position_slug: 'all',
    is_required: true,
    is_active: true,
    help_text: null,
    min_length: null,
    max_length: null,
    sort_order: questions.reduce((max, item) => Math.max(max, item.sort_order ?? 0), 0) + 1,
    options: [],
  }
}

export interface QuestionEditorProps {
  open: boolean
  question?: Question | null
  questions: Question[]
  saving?: boolean
  onClose: () => void
  onSave: (payload: QuestionPayload) => void
}

export default function QuestionEditor({
  open,
  question,
  questions,
  saving = false,
  onClose,
  onSave,
}: QuestionEditorProps) {
  const categories = useMemo(() => buildCategories(questions), [questions])
  const [form, setForm] = useState<QuestionPayload>(() => emptyPayload(questions))
  const [optionRows, setOptionRows] = useState<OptionRow[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    if (question) {
      setForm({
        question_text: question.question_text ?? '',
        type: question.type ?? 'short_text',
        category_id: question.category_id ?? null,
        position_slug: question.position_slug ?? 'all',
        is_required: Boolean(question.is_required),
        is_active: question.is_active !== false,
        help_text: question.help_text ?? null,
        min_length: question.min_length ?? null,
        max_length: question.max_length ?? null,
        sort_order: question.sort_order ?? 0,
      })
      setOptionRows(toOptionRows(question.options))
    } else {
      setForm(emptyPayload(questions))
      setOptionRows([])
    }
  }, [open, question, questions])

  const choiceMode = CHOICE_TYPES.includes(form.type)
  const textMode = TEXT_TYPES.includes(form.type)

  const update = <K extends keyof QuestionPayload>(key: K, value: QuestionPayload[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const updateOption = (index: number, key: keyof OptionRow, value: string) => {
    setOptionRows((current) =>
      current.map((option, position) => (position === index ? { ...option, [key]: value } : option)),
    )
  }

  const moveOption = (index: number, direction: -1 | 1) => {
    setOptionRows((current) => {
      const target = index + direction
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return next
    })
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    setError('')
    const text = form.question_text.trim()
    if (text.length < 3 || text.length > 500) {
      setError('Soru metni 3 ile 500 karakter arasında olmalıdır.')
      return
    }
    if (
      form.min_length !== null &&
      form.max_length !== null &&
      form.min_length > form.max_length
    ) {
      setError('En az karakter sayısı, en fazla karakter sayısından büyük olamaz.')
      return
    }
    if (choiceMode) {
      if (optionRows.length < 2) {
        setError('Seçenekli sorular için en az iki seçenek ekleyin.')
        return
      }
      if (optionRows.some((option) => !option.label.trim() || !option.value.trim())) {
        setError('Her seçeneğin hem görünen adı hem de değeri olmalıdır.')
        return
      }
      if (new Set(optionRows.map((option) => option.value.trim())).size !== optionRows.length) {
        setError('Seçenek değerleri birbirinden farklı olmalıdır.')
        return
      }
    }

    onSave({
      ...form,
      question_text: text,
      help_text: form.help_text?.trim() ? form.help_text.trim() : null,
      options: choiceMode
        ? optionRows.map((option, index) => ({
            label: option.label.trim(),
            value: option.value.trim(),
            sort_order: index,
            is_active: true,
          }))
        : [],
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={question ? 'Soruyu düzenle' : 'Yeni soru ekle'}
      description="Alanları doldurun; değişiklikler kaydedildiğinde başvuru formunda hemen görünür."
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" form="question-editor-form" loading={saving} icon={<Save size={16} />}>
            {question ? 'Değişiklikleri kaydet' : 'Soruyu ekle'}
          </Button>
        </>
      }
    >
      <form id="question-editor-form" onSubmit={handleSubmit} className="space-y-4">
        <Textarea
          label="Soru metni"
          required
          rows={2}
          maxLength={500}
          value={form.question_text}
          placeholder="Örn. Bir oyuncu kuralları ihlal ettiğinde nasıl davranırsın?"
          onChange={(event) => update('question_text', event.target.value)}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Soru tipi"
            value={form.type}
            options={QUESTION_TYPES.map((type) => ({ value: type.value, label: type.label }))}
            hint={QUESTION_TYPES.find((type) => type.value === form.type)?.description}
            onChange={(event) => {
              const type = event.target.value as QuestionType
              update('type', type)
              if (!CHOICE_TYPES.includes(type)) setOptionRows([])
            }}
          />
          <Select
            label="Kategori"
            value={form.category_id ?? ''}
            options={[
              { value: '', label: 'Kategori seçilmedi' },
              ...categories.map((category) => ({ value: category.id, label: category.label })),
            ]}
            onChange={(event) => update('category_id', event.target.value || null)}
          />
          <Select
            label="Hangi pozisyona sorulsun?"
            value={form.position_slug ?? 'all'}
            options={[
              { value: 'all', label: 'Tümü' },
              { value: 'rehber', label: 'Rehber' },
              { value: 'aac', label: 'AAC' },
            ]}
            onChange={(event) =>
              update('position_slug', event.target.value as QuestionPayload['position_slug'])
            }
          />
          <Input
            label="Açıklama (isteğe bağlı)"
            value={form.help_text ?? ''}
            maxLength={500}
            placeholder="Başvurana küçük bir ipucu"
            onChange={(event) => update('help_text', event.target.value || null)}
          />
        </div>

        <div className="flex flex-wrap gap-5 rounded-lg border border-white/5 bg-black/20 px-4 py-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={form.is_required}
              onChange={(event) => update('is_required', event.target.checked)}
              className="h-4 w-4 accent-emerald-400"
            />
            Zorunlu mu?
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(event) => update('is_active', event.target.checked)}
              className="h-4 w-4 accent-emerald-400"
            />
            Aktif mi?
          </label>
        </div>

        {textMode && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              type="number"
              min={0}
              max={4000}
              label="En az karakter"
              value={form.min_length ?? ''}
              placeholder="Sınırsız"
              onChange={(event) => update('min_length', event.target.value ? Number(event.target.value) : null)}
            />
            <Input
              type="number"
              min={0}
              max={4000}
              label="En fazla karakter"
              value={form.max_length ?? ''}
              placeholder="Sınırsız"
              onChange={(event) => update('max_length', event.target.value ? Number(event.target.value) : null)}
            />
          </div>
        )}

        {form.type === 'number' && (
          <p className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-4 py-3 text-sm text-cyan-200">
            Sayısal sorular için geçerli aralık başvuru formunda otomatik uygulanır.
          </p>
        )}

        {choiceMode && (
          <div className="rounded-lg border border-white/5 bg-black/20 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-100">Seçenekler</p>
                <p className="text-xs text-slate-500">Yukarı/aşağı oklarıyla sıralamayı değiştirin.</p>
              </div>
              <Button
                variant="secondary"
                icon={<Plus size={15} />}
                onClick={() => setOptionRows((current) => [...current, { label: '', value: '' }])}
              >
                Seçenek ekle
              </Button>
            </div>
            {optionRows.length === 0 ? (
              <p className="rounded-md border border-dashed border-white/10 px-3 py-5 text-center text-sm text-slate-500">
                Henüz seçenek yok. En az iki seçenek ekleyin.
              </p>
            ) : (
              <ul className="space-y-2">
                {optionRows.map((option, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <span className="mt-2 w-5 shrink-0 text-center font-mono text-xs text-slate-500">
                      {index + 1}
                    </span>
                    <Input
                      aria-label={`${index + 1}. seçenek adı`}
                      value={option.label}
                      placeholder="Görünen seçenek"
                      onChange={(event) => updateOption(index, 'label', event.target.value)}
                    />
                    <Input
                      aria-label={`${index + 1}. seçenek değeri`}
                      value={option.value}
                      placeholder="deger"
                      onChange={(event) => updateOption(index, 'value', event.target.value)}
                    />
                    <div className="flex shrink-0 flex-col gap-1">
                      <button
                        type="button"
                        aria-label={`${index + 1}. seçeneği yukarı taşı`}
                        onClick={() => moveOption(index, -1)}
                        disabled={index === 0}
                        className="rounded border border-white/10 p-1 text-slate-400 hover:text-white disabled:opacity-30"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label={`${index + 1}. seçeneği aşağı taşı`}
                        onClick={() => moveOption(index, 1)}
                        disabled={index === optionRows.length - 1}
                        className="rounded border border-white/10 p-1 text-slate-400 hover:text-white disabled:opacity-30"
                      >
                        <ArrowDown size={14} />
                      </button>
                    </div>
                    <button
                      type="button"
                      aria-label={`${index + 1}. seçeneği sil`}
                      onClick={() => setOptionRows((current) => current.filter((_, i) => i !== index))}
                      className="mt-1 rounded border border-red-400/30 p-1.5 text-red-300 hover:bg-red-500/10"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
