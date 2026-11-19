import type {
  ApplicationStatus,
  PositionSlug,
  QuestionType,
  ScoreCriterionKey,
} from '../types'

export interface QuestionTypeOption {
  value: QuestionType
  label: string
  description: string
}

export const QUESTION_TYPES: QuestionTypeOption[] = [
  {
    value: 'short_text',
    label: 'Kısa metin',
    description: 'Tek satırlık kısa cevaplar için.',
  },
  {
    value: 'long_text',
    label: 'Uzun metin',
    description: 'Açıklama ve görüşler için çok satırlı cevap.',
  },
  {
    value: 'number',
    label: 'Sayı',
    description: 'Sayısal bir değer girişi.',
  },
  {
    value: 'single_choice',
    label: 'Tek seçenek',
    description: 'Seçeneklerden yalnızca birini seçme.',
  },
  {
    value: 'multiple_choice',
    label: 'Çoklu seçenek',
    description: 'Seçeneklerden bir veya birden fazlasını seçme.',
  },
  {
    value: 'yes_no',
    label: 'Evet / Hayır',
    description: 'İki seçenekli hızlı onay sorusu.',
  },
  {
    value: 'checkbox',
    label: 'Onay kutusu',
    description: 'Koşulu onaylamak için işaretleme.',
  },
]

export interface ScoreCriterion {
  key: ScoreCriterionKey
  label: string
  /** Maksimum puan (toplam 100). */
  max: number
  /** `max` alanının takma adı — formlar ve hesaplamalar için. */
  weight: number
  max_score: number
}

export const SCORE_CRITERIA: ScoreCriterion[] = [
  { key: 'communication', label: 'İletişim', max: 20, weight: 20, max_score: 20 },
  { key: 'knowledge', label: 'Bilgi seviyesi', max: 20, weight: 20, max_score: 20 },
  { key: 'responsibility', label: 'Sorumluluk', max: 15, weight: 15, max_score: 15 },
  { key: 'problem_solving', label: 'Problem çözme', max: 15, weight: 15, max_score: 15 },
  { key: 'experience', label: 'Deneyim', max: 15, weight: 15, max_score: 15 },
  { key: 'position_fit', label: 'Pozisyona uygunluk', max: 15, weight: 15, max_score: 15 },
]

export interface PositionOption {
  slug: PositionSlug
  value: PositionSlug
  name: string
  label: string
  description: string
}

export const POSITIONS: PositionOption[] = [
  {
    slug: 'rehber',
    value: 'rehber',
    name: 'Rehber',
    label: 'Rehber',
    description: 'Topluluk rehberliği ve oyuncu desteği ekibi.',
  },
  {
    slug: 'aac',
    value: 'aac',
    name: 'AAC',
    label: 'AAC',
    description: 'AAC sunucu ve topluluk yönetimi ekibi.',
  },
]

export interface QuestionCategoryOption {
  slug: string
  value: string
  name: string
  label: string
  description: string
}

export const QUESTION_CATEGORIES: QuestionCategoryOption[] = [
  {
    slug: 'general',
    value: 'general',
    name: 'Genel bilgiler',
    label: 'Genel bilgiler',
    description: 'Başvuranın temel bilgileri.',
  },
  {
    slug: 'rehber',
    value: 'rehber',
    name: 'Rehber soruları',
    label: 'Rehber soruları',
    description: 'Rehberlik başvurusuna özel sorular.',
  },
  {
    slug: 'aac',
    value: 'aac',
    name: 'AAC soruları',
    label: 'AAC soruları',
    description: 'AAC başvurusuna özel sorular.',
  },
  {
    slug: 'experience',
    value: 'experience',
    name: 'Deneyim',
    label: 'Deneyim',
    description: 'Önceki deneyimler ve katkılar.',
  },
  {
    slug: 'scenario',
    value: 'scenario',
    name: 'Senaryo değerlendirmesi',
    label: 'Senaryo değerlendirmesi',
    description: 'Durum bazlı değerlendirme soruları.',
  },
]

export interface ApplicationStatusOption {
  value: ApplicationStatus
  status: ApplicationStatus
  label: string
  description: string
}

export const APPLICATION_STATUSES: ApplicationStatusOption[] = [
  {
    value: 'pending',
    status: 'pending',
    label: 'Beklemede',
    description: 'Başvuru henüz incelenmedi.',
  },
  {
    value: 'reviewing',
    status: 'reviewing',
    label: 'İnceleniyor',
    description: 'Başvuru yönetici tarafından inceleniyor.',
  },
  {
    value: 'accepted',
    status: 'accepted',
    label: 'Kabul edildi',
    description: 'Başvuru onaylandı.',
  },
  {
    value: 'rejected',
    status: 'rejected',
    label: 'Reddedildi',
    description: 'Başvuru uygun bulunmadı.',
  },
]

export const API_ENDPOINTS = {
  adminAuth: '/functions/v1/admin-auth',
  submitApplication: '/functions/v1/submit-application',
  publicStatus: '/functions/v1/public-status',
  adminQuestions: '/functions/v1/admin-questions',
  adminPositions: '/functions/v1/admin-positions',
  adminApplications: '/functions/v1/admin-applications',
  adminScores: '/functions/v1/admin-scores',
  adminSettings: '/functions/v1/admin-settings',
  discordOAuth: '/functions/v1/discord-oauth',
  discordNotify: '/functions/v1/discord-notify',
} as const
