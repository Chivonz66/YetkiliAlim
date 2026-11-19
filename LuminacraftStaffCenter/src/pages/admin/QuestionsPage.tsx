import { useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  CircleHelp,
  GripVertical,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import QuestionEditor from '../../components/admin/QuestionEditor'
import { useAdminToast } from '../../components/admin/AdminLayout'
import {
  createQuestion,
  deleteQuestion,
  listQuestions,
  reorderQuestions,
  updateQuestion,
  type QuestionPayload,
} from '../../lib/api-admin'
import { QUESTION_CATEGORIES, QUESTION_TYPES, POSITIONS } from '../../lib/constants'
import type { Question } from '../../types'

const CATEGORY_IDS = QUESTION_CATEGORIES.map((_, index) =>
  `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
)

function categoryMeta(categoryId: string | null): { label: string; description?: string; order: number } {
  const index = categoryId ? CATEGORY_IDS.indexOf(categoryId) : 0
  const item = index >= 0 ? QUESTION_CATEGORIES[index] : undefined
  return {
    label: item?.label ?? 'Diğer sorular',
    description: item?.description,
    order: index >= 0 ? index : QUESTION_CATEGORIES.length,
  }
}

function positionLabel(position: Question['position_slug']): string {
  if (position === 'rehber' || position === 'aac') {
    return POSITIONS.find((item) => item.slug === position)?.label ?? position
  }
  return 'Tümü'
}

function SortableQuestionCard({
  question,
  onEdit,
  onDelete,
}: {
  question: Question
  onEdit: (question: Question) => void
  onDelete: (question: Question) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: question.id,
  })
  const style = { transform: CSS.Transform.toString(transform), transition }
  const typeLabel = QUESTION_TYPES.find((item) => item.value === question.type)?.label ?? question.type

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-start gap-3 rounded-lg border border-white/5 bg-black/20 p-3 ${
        isDragging ? 'z-10 border-emerald-400/40 opacity-90 shadow-xl' : ''
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`${question.question_text} sorusunun sırasını değiştir`}
        title="Sürükleyerek veya klavye ile taşı"
        className="mt-0.5 cursor-grab rounded-md border border-white/10 bg-white/5 p-1.5 text-slate-400 transition-colors hover:text-white active:cursor-grabbing"
      >
        <GripVertical size={16} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-slate-100">{question.question_text}</p>
          {!question.is_active && <Badge variant="default">Pasif</Badge>}
          {question.is_required && <Badge variant="info">Zorunlu</Badge>}
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
          <Badge variant="default">{typeLabel}</Badge>
          <Badge variant="default">{positionLabel(question.position_slug)}</Badge>
          {(question.options?.length ?? 0) > 0 && (
            <Badge variant="default">{question.options?.length} seçenek</Badge>
          )}
        </div>
        {question.help_text && (
          <p className="mt-2 text-xs italic text-slate-500">{question.help_text}</p>
        )}
      </div>
      <div className="flex shrink-0 gap-1">
        <button
          type="button"
          onClick={() => onEdit(question)}
          aria-label={`${question.question_text} sorusunu düzenle`}
          className="rounded-md p-2 text-slate-400 transition-colors hover:bg-cyan-400/10 hover:text-cyan-200"
        >
          <Pencil size={16} />
        </button>
        <button
          type="button"
          onClick={() => onDelete(question)}
          aria-label={`${question.question_text} sorusunu sil`}
          className="rounded-md p-2 text-slate-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </li>
  )
}

function SortableQuestionGroup({
  groupId,
  questions,
  onEdit,
  onDelete,
  onReorder,
}: {
  groupId: string
  questions: Question[]
  onEdit: (question: Question) => void
  onDelete: (question: Question) => void
  onReorder: (groupId: string, ids: string[]) => void
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = questions.findIndex((question) => question.id === active.id)
    const newIndex = questions.findIndex((question) => question.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    onReorder(
      groupId,
      arrayMove(questions, oldIndex, newIndex).map((question) => question.id),
    )
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={questions.map((question) => question.id)} strategy={verticalListSortingStrategy}>
        <ul className="space-y-2">
          {questions.map((question) => (
            <SortableQuestionCard
              key={question.id}
              question={question}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}

export default function QuestionsPage() {
  const [questions, setQuestions] = useState<Question[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Question | null>(null)
  const [deleting, setDeleting] = useState<Question | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const notify = useAdminToast()

  const load = () => setReloadKey((key) => key + 1)

  useEffect(() => {
    let active = true
    setLoading(true)
    listQuestions()
      .then((items) => {
        if (active) setQuestions(items)
      })
      .catch((caught) => {
        if (active) notify(caught instanceof Error ? caught.message : 'Sorular yüklenemedi.', 'error')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [reloadKey, notify])

  const groups = useMemo(() => {
    const buckets = new Map<string, Question[]>()
    for (const question of questions) {
      const key = question.category_id ?? 'general'
      buckets.set(key, [...(buckets.get(key) ?? []), question])
    }
    return Array.from(buckets.entries())
      .map(([id, items]) => ({
        id,
        ...categoryMeta(id === 'general' ? null : id),
        questions: [...items].sort((a, b) => a.sort_order - b.sort_order),
      }))
      .sort((a, b) => a.order - b.order)
  }, [questions])

  const openCreate = () => {
    setEditing(null)
    setEditorOpen(true)
  }

  const openEdit = (question: Question) => {
    setEditing(question)
    setEditorOpen(true)
  }

  const handleSave = async (payload: QuestionPayload) => {
    setSaving(true)
    try {
      if (editing) {
        await updateQuestion({ ...payload, id: editing.id })
        notify('Soru güncellendi.', 'success')
      } else {
        await createQuestion(payload)
        notify('Yeni soru eklendi.', 'success')
      }
      setEditorOpen(false)
      setEditing(null)
      load()
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Soru kaydedilemedi.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleting) return
    setSaving(true)
    try {
      await deleteQuestion(deleting.id)
      notify('Soru silindi.', 'success')
      setDeleting(null)
      load()
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Soru silinemedi.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleReorder = async (groupId: string, groupIds: string[]) => {
    const previousIds = questions.map((question) => question.id)
    const groupSet = new Set(
      questions.filter((question) => (question.category_id ?? 'general') === groupId).map((q) => q.id),
    )
    let cursor = 0
    const nextIds = previousIds.map((id) => (groupSet.has(id) ? groupIds[cursor++] : id))

    // Anlık görsel güncelleme; sunucu onaylamazsa yeniden yüklenir.
    const rank = new Map(nextIds.map((id, index) => [id, index]))
    setQuestions((current) =>
      current
        .map((question) => ({ ...question, sort_order: rank.get(question.id) ?? question.sort_order }))
        .sort((a, b) => a.sort_order - b.sort_order),
    )
    try {
      await reorderQuestions(nextIds)
      notify('Soru sırası kaydedildi.', 'success')
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Sıralama kaydedilemedi.', 'error')
      load()
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-black text-white">Sorular</h1>
          <p className="mt-1 text-sm text-slate-400">
            Başvuru formundaki soruları ekleyin, düzenleyin ve sürükleyerek sıralayın.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={<RefreshCw size={16} />} onClick={load} loading={loading}>
            Yenile
          </Button>
          <Button icon={<Plus size={16} />} onClick={openCreate}>
            Yeni soru ekle
          </Button>
        </div>
      </header>

      <div className="rounded-lg border border-cyan-400/15 bg-cyan-400/5 px-4 py-3 text-sm text-cyan-200">
        İpucu: Soruları <GripVertical size={14} className="inline align-text-bottom" /> tutamacından
        sürükleyerek taşıyabilir veya klavyede tutamacı seçip boşluk tuşuyla hareket
        ettirebilirsiniz. Sıralama otomatik kaydedilir.
      </div>

      {loading ? (
        <div className="flex min-h-[260px] flex-col items-center justify-center gap-3" role="status">
          <Spinner size={30} />
          <p className="text-sm text-slate-400">Sorular yükleniyor...</p>
        </div>
      ) : groups.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <CircleHelp size={30} className="text-slate-600" />
            <p className="font-semibold text-slate-200">Henüz soru eklenmedi</p>
            <p className="text-sm text-slate-500">Başvuru formu için ilk sorunuzu ekleyin.</p>
            <Button className="mt-3" icon={<Plus size={16} />} onClick={openCreate}>
              Yeni soru ekle
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <Card
              key={group.id}
              title={group.label}
              description={group.description ?? `${group.questions.length} soru`}
              actions={<Badge variant="default">{group.questions.length} soru</Badge>}
            >
              <SortableQuestionGroup
                groupId={group.id}
                questions={group.questions}
                onEdit={openEdit}
                onDelete={setDeleting}
                onReorder={handleReorder}
              />
            </Card>
          ))}
        </div>
      )}

      <QuestionEditor
        open={editorOpen}
        question={editing}
        questions={questions}
        saving={saving}
        onClose={() => {
          setEditorOpen(false)
          setEditing(null)
        }}
        onSave={handleSave}
      />

      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Soruyu sil"
        description="Bu işlem geri alınamaz."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>Vazgeç</Button>
            <Button variant="danger" loading={saving} icon={<Trash2 size={16} />} onClick={handleDelete}>
              Evet, sil
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          <strong className="text-white">{deleting?.question_text}</strong> sorusu silinecek. Geçmiş
          başvurularda verilen cevaplar anlık görüntü olarak korunur.
        </p>
      </Modal>
    </div>
  )
}
