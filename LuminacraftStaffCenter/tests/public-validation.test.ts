import { describe, expect, it } from 'vitest'
import { isAnswerValid } from '../src/lib/utils'
import { POSITIONS, QUESTION_TYPES } from '../src/lib/constants'
import { answerToDisplayValue } from '../src/components/public/QuestionRenderer'
import {
  DEFAULT_CLOSED_MESSAGE,
  areApplicationsOpen,
  buildApplicationPayload,
  computeElapsedMs,
  getClosedMessage,
  getDiscordOAuthUrl,
  getQuestionOptions,
  getSettingFlag,
  groupQuestions,
  isHoneypotFilled,
  isPositionOpen,
  mapPublicQuestion,
  normalizeAnswers,
  positionOpenSettingKey,
} from '../src/lib/api-public'
import type { Question, QuestionType } from '../src/types'

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q-1',
    category_id: 'general',
    position_slug: 'all',
    type: 'short_text',
    question_text: 'Örnek soru',
    is_required: true,
    is_active: true,
    sort_order: 0,
    ...overrides,
  }
}

const ALL_TYPES: QuestionType[] = QUESTION_TYPES.map((item) => item.value)

describe('herkese açık form doğrulama', () => {
  it('T1 ile aynı yedi soru tipini destekler', () => {
    expect(ALL_TYPES).toEqual([
      'short_text',
      'long_text',
      'number',
      'single_choice',
      'multiple_choice',
      'yes_no',
      'checkbox',
    ])
    for (const type of ALL_TYPES) {
      expect(typeof isAnswerValid(type, 'geçerli cevap')).toBe('boolean')
    }
  })

  it('zorunlu sorularda boş cevabı reddeder, isteğe bağlıda kabul eder', () => {
    for (const type of ALL_TYPES) {
      expect(isAnswerValid(type, '', { required: true })).toBe(false)
      expect(isAnswerValid(type, null, { required: true })).toBe(false)
      expect(isAnswerValid(type, [], { required: true })).toBe(false)
      expect(isAnswerValid(type, '', { required: false })).toBe(true)
    }
  })

  it('short_text: alt ve üst karakter sınırlarını uygular', () => {
    expect(isAnswerValid('short_text', 'Lumina', { minLength: 3, maxLength: 10 })).toBe(true)
    expect(isAnswerValid('short_text', 'Ab', { minLength: 3 })).toBe(false)
    expect(isAnswerValid('short_text', 'Çok uzun bir cevap', { maxLength: 6 })).toBe(false)
    expect(isAnswerValid('short_text', '   ', { required: true })).toBe(false)
    expect(isAnswerValid('short_text', 42)).toBe(false)
  })

  it('long_text: çok satırlı cevap ve sınırlar', () => {
    const answer = 'Önce satır bir.\nSonra satır iki.'
    expect(isAnswerValid('long_text', answer, { required: true, minLength: 10, maxLength: 80 })).toBe(true)
    expect(isAnswerValid('long_text', 'kısa', { minLength: 10 })).toBe(false)
    expect(isAnswerValid('long_text', answer, { maxLength: 5 })).toBe(false)
  })

  it('number: sayısal değer ve sayısal sınırlar', () => {
    expect(isAnswerValid('number', 42, { required: true, minLength: 16, maxLength: 99 })).toBe(true)
    expect(isAnswerValid('number', '42')).toBe(true)
    expect(isAnswerValid('number', 'abc')).toBe(false)
    expect(isAnswerValid('number', 12, { minLength: 16 })).toBe(false)
    expect(isAnswerValid('number', 120, { maxLength: 99 })).toBe(false)
  })

  it('single_choice: yalnızca tanımlı seçeneklere izin verir', () => {
    const options = ['her_gun', 'haftada_bir']
    expect(isAnswerValid('single_choice', 'her_gun', { required: true, options })).toBe(true)
    expect(isAnswerValid('single_choice', 'bilinmeyen', { options })).toBe(false)
    expect(isAnswerValid('single_choice', 5, { options })).toBe(false)
    expect(isAnswerValid('single_choice', 'serbest')).toBe(true)
  })

  it('multiple_choice: dizi, seçenek listesi ve zorunluluk kontrolü', () => {
    const options = ['discord', 'teamspeak', 'forum']
    expect(isAnswerValid('multiple_choice', ['discord', 'forum'], { required: true, options })).toBe(true)
    expect(isAnswerValid('multiple_choice', ['yok'], { options })).toBe(false)
    expect(isAnswerValid('multiple_choice', [], { required: true })).toBe(false)
    expect(isAnswerValid('multiple_choice', [], { required: false })).toBe(true)
  })

  it('yes_no: boolean ve Türkçe/İngilizce metinleri kabul eder', () => {
    expect(isAnswerValid('yes_no', true, { required: true })).toBe(true)
    expect(isAnswerValid('yes_no', false, { required: true })).toBe(true)
    expect(isAnswerValid('yes_no', 'EVET', { required: true })).toBe(true)
    expect(isAnswerValid('yes_no', 'hayır', { required: true })).toBe(true)
    expect(isAnswerValid('yes_no', 'belki', { required: true })).toBe(false)
  })

  it('checkbox: zorunlu onay için true ister', () => {
    expect(isAnswerValid('checkbox', true, { required: true })).toBe(true)
    expect(isAnswerValid('checkbox', false, { required: true })).toBe(false)
    expect(isAnswerValid('checkbox', false, { required: false })).toBe(true)
    expect(isAnswerValid('checkbox', 'evet', { required: true })).toBe(true)
  })
})

describe('answerToDisplayValue', () => {
  it('tek seçenek sorularında seçenek etiketini gösterir', () => {
    const question = makeQuestion({
      type: 'single_choice',
      options: [
        { label: 'Her gün', value: 'her_gun', sort_order: 0 },
        { label: 'Haftada bir', value: 'haftada_bir', sort_order: 1 },
      ],
    })
    expect(answerToDisplayValue(question, 'her_gun')).toBe('Her gün')
    expect(answerToDisplayValue(question, 'tanimsiz')).toBe('tanimsiz')
  })

  it('çoklu seçenek cevaplarını etiketlerle ve virgülle birleştirir', () => {
    const question = makeQuestion({
      type: 'multiple_choice',
      options: [
        { label: 'Rehberlik', value: 'rehber', sort_order: 0 },
        { label: 'Etkinlik', value: 'etkinlik', sort_order: 1 },
      ],
    })
    expect(answerToDisplayValue(question, ['rehber', 'etkinlik'])).toBe('Rehberlik, Etkinlik')
    expect(answerToDisplayValue(question, [])).toBe('—')
  })

  it('evet/hayır ve onay kutusu cevaplarını Türkçe yazar', () => {
    const yesNo = makeQuestion({ type: 'yes_no' })
    const checkbox = makeQuestion({ type: 'checkbox' })
    expect(answerToDisplayValue(yesNo, true)).toBe('Evet')
    expect(answerToDisplayValue(yesNo, false)).toBe('Hayır')
    expect(answerToDisplayValue(yesNo, 'evet')).toBe('Evet')
    expect(answerToDisplayValue(checkbox, true)).toBe('Onaylandı')
    expect(answerToDisplayValue(checkbox, false)).toBe('Onaylanmadı')
  })

  it('boş cevapları ve metin/sayı cevaplarını güvenli biçimde gösterir', () => {
    expect(answerToDisplayValue(makeQuestion(), undefined)).toBe('—')
    expect(answerToDisplayValue(makeQuestion(), '  ')).toBe('—')
    expect(answerToDisplayValue(makeQuestion(), 'Merhaba')).toBe('Merhaba')
    expect(answerToDisplayValue(makeQuestion({ type: 'number' }), 18)).toBe('18')
  })
})

describe('pozisyon ve seçenek yardımcıları', () => {
  it('yalnızca tanımlı pozisyon slugları kabul edilir', () => {
    const isValid = (slug?: string) => POSITIONS.some((position) => position.slug === slug)
    expect(POSITIONS.map((position) => position.slug)).toEqual(['rehber', 'aac'])
    expect(isValid('rehber')).toBe(true)
    expect(isValid('aac')).toBe(true)
    expect(isValid('admin')).toBe(false)
    expect(isValid(undefined)).toBe(false)
  })

  it('iç içe ve düz seçenek biçimlerini okur, sıralar ve tekrarları temizler', () => {
    const nested = makeQuestion({
      options: [{ label: 'Evet', value: 'yes', sort_order: 1 }],
      question_options: [{ label: 'Hayır', value: 'no', sort_order: 0 }],
    } as unknown as Question)
    expect(getQuestionOptions(nested).map((option) => option.value)).toEqual(['no', 'yes'])

    const flat = makeQuestion({ question_text: 'Bu metin seçenek değildir' }) as Question & {
      option_label?: string
      option_value?: string
    }
    flat.option_label = 'Hepsi'
    flat.option_value = 'all'
    expect(getQuestionOptions(flat)).toEqual([
      { label: 'Hepsi', value: 'all', sort_order: 0, is_active: true, id: undefined, question_id: undefined },
    ])
  })

  it('soruları kategoriye göre gruplar', () => {
    const groups = groupQuestions([
      makeQuestion({ id: 'q-2', category_id: 'experience', sort_order: 2 }),
      makeQuestion({ id: 'q-1', category_id: 'general', sort_order: 1 }),
    ])
    expect(groups.map((group) => group.name)).toEqual(['Genel bilgiler', 'Deneyim'])
    expect(groups[0].questions[0].id).toBe('q-1')
  })
})

describe('get_public_questions RPC yanıtı', () => {
  it('question_type alanını yedi soru tipine doğru eşler', () => {
    for (const type of ALL_TYPES) {
      const mapped = mapPublicQuestion({
        id: `q-${type}`,
        question_type: type,
        category_slug: 'general',
        category_name: 'Genel bilgiler',
        question_text: `${type} sorusu`,
        is_required: true,
        sort_order: 1,
      })
      expect(mapped?.type).toBe(type)
    }
  })

  it('category_slug alanından adım gruplarını oluşturur', () => {
    const questions = [
      { id: 'q-1', question_type: 'short_text', category_slug: 'general', category_name: 'Genel bilgiler', question_text: 'Ad', is_required: true },
      { id: 'q-2', question_type: 'single_choice', category_slug: 'rehber', category_name: 'Rehber soruları', question_text: 'Soru', is_required: true },
    ].map((row) => mapPublicQuestion(row)!)

    expect(questions.map((question) => question.category_id)).toEqual(['general', 'rehber'])
    expect(groupQuestions(questions).map((group) => group.name)).toEqual(['Genel bilgiler', 'Rehber soruları'])
  })

  it('options_snapshot seçeneklerini okur, type alanıyla da uyumludur', () => {
    const mapped = mapPublicQuestion({
      id: 'q-3',
      type: 'multiple_choice',
      category_slug: 'rehber',
      question_text: 'Destek alanları',
      is_required: true,
      options_snapshot: [{ label: 'Oyuncu desteği', value: 'destek', sort_order: 0 }],
    })
    expect(mapped?.type).toBe('multiple_choice')
    expect(getQuestionOptions(mapped).map((option) => option.value)).toEqual(['destek'])
  })
})

describe('başvuru gönderimi güvenliği', () => {
  it('honeypot alanı doluysa bot olarak algılanır', () => {
    expect(isHoneypotFilled('')).toBe(false)
    expect(isHoneypotFilled('   ')).toBe(false)
    expect(isHoneypotFilled('https://spam.example')).toBe(true)
  })

  it('geçen süreyi negatif olmadan ve üst sınırla hesaplar', () => {
    expect(computeElapsedMs(1000, 3500)).toBe(2500)
    expect(computeElapsedMs(5000, 1000)).toBe(0)
    expect(computeElapsedMs(0, 10_000_000)).toBe(3_600_000)
    expect(computeElapsedMs(Number.NaN, 1000)).toBe(0)
  })

  it('sunucuya yalnızca soru kimliği ve cevap gönderir', () => {
    const payload = buildApplicationPayload({
      position_slug: 'rehber',
      applicant: { minecraft_username: 'Lumina' },
      answers: { 'q-1': 'Merhaba', 'q-2': '', 'q-3': [] },
      website: '',
      elapsed_ms: 1200,
    })
    expect(payload.answers).toEqual([{ question_id: 'q-1', value: 'Merhaba' }])
    expect(payload.elapsed_ms).toBe(1200)
    expect(payload.website).toBe('')
    expect(JSON.stringify(payload)).not.toContain('question_text')
    expect(JSON.stringify(payload)).not.toContain('options')
  })

  it('dizi biçimindeki cevaplardaki ek alanları ayıklar', () => {
    const answers = normalizeAnswers([
      { question_id: 'q-9', value: true, question_text: 'gizli', type: 'checkbox' } as never,
    ])
    expect(answers).toEqual([{ question_id: 'q-9', value: true }])
  })

  it('imzalı Discord bağlantı belirteci gövde ve OAuth başlangıç URL sinde taşınır', () => {
    const payload = buildApplicationPayload({
      position_slug: 'rehber',
      applicant: { minecraft_username: 'Lumina' },
      answers: {},
      website: '',
      elapsed_ms: 0,
      discord_link_token: 'imzali-belirtek',
    })
    expect(payload.discord_link_token).toBe('imzali-belirtek')

    const url = getDiscordOAuthUrl('/apply/rehber', 'imzali-belirtek')
    expect(url).toContain('action=start')
    expect(url).toContain('return_to=')
    expect(url).toContain('discord_link_token=imzali-belirtek')
    expect(getDiscordOAuthUrl('/apply/rehber', '')).not.toContain('discord_link_token')
  })
})

describe('kapalı başvuru ve ayarlar', () => {
  it('ayar yoksa öntanımlı Türkçe kapalı mesajını kullanır', () => {
    expect(getClosedMessage({})).toBe(DEFAULT_CLOSED_MESSAGE)
    expect(getClosedMessage({ closed_message: '   ' })).toBe(DEFAULT_CLOSED_MESSAGE)
  })

  it('yönetim mesajı varsa öntanımlı mesajın yerine gösterir', () => {
    expect(getClosedMessage({ closed_message: '  Başvurular geçici olarak durduruldu. ' })).toBe(
      'Başvurular geçici olarak durduruldu.',
    )
  })

  it('string ve boolean kapalı değerlerini doğru yorumlar', () => {
    expect(getSettingFlag({ applications_open: 'false' }, 'applications_open')).toBe(false)
    expect(getSettingFlag({ applications_open: '0' }, 'applications_open')).toBe(false)
    expect(getSettingFlag({ applications_open: 'true' }, 'applications_open')).toBe(true)
    expect(areApplicationsOpen({ applications_open: false })).toBe(false)
    expect(areApplicationsOpen({})).toBe(true)
    expect(isPositionOpen({ aac_applications_open: '0' }, 'aac', { is_active: true })).toBe(false)
    expect(isPositionOpen({}, 'rehber', { is_active: true })).toBe(true)
    expect(isPositionOpen({}, 'rehber', { is_active: false })).toBe(false)
  })

  it('pozisyon açıklığının tek kaynağı ${slug}_applications_open anahtarıdır', () => {
    expect(positionOpenSettingKey('rehber')).toBe('rehber_applications_open')
    expect(isPositionOpen({ rehber_applications_open: false }, 'rehber')).toBe(false)
    expect(isPositionOpen({ rehber_applications_open: 'false' }, 'rehber')).toBe(false)
    expect(isPositionOpen({ rehber_applications_open: true }, 'rehber')).toBe(true)
    // Eski anahtarlar artık pozisyonu açık/kapalı yapmaz.
    expect(isPositionOpen({ rehber_is_open: false, rehber_open: false }, 'rehber')).toBe(true)
    expect(
      isPositionOpen({ rehber_applications_open: true, applications_open: false }, 'rehber'),
    ).toBe(false)
  })

  it('yaş alanı kanonik 16–99 aralığını kullanır', () => {
    const ageBounds = { required: true, minLength: 16, maxLength: 99 }
    expect(isAnswerValid('number', 16, ageBounds)).toBe(true)
    expect(isAnswerValid('number', 99, ageBounds)).toBe(true)
    expect(isAnswerValid('number', 15, ageBounds)).toBe(false)
    expect(isAnswerValid('number', 100, ageBounds)).toBe(false)
  })
})
