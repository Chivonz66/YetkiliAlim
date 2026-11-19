// Zod şemaları. Zod yalnızca Edge çalışma zamanında esm.sh üzerinden yüklenir;
// aynı kurallar Node/Vitest için _shared/pure.ts içinde saf olarak bulunur.
import {
  QUESTION_TYPES,
  isValidAge,
  isValidDiscordUsername,
  isValidHours,
  isValidMinecraftUsername,
  isValidTrackingNo,
} from './pure.ts'

type Schema = {
  safeParse: (input: unknown) => {
    success: boolean
    data?: unknown
    error?: { issues?: Array<{ message?: string; path?: Array<string | number> }> }
  }
}

type SchemaName =
  | 'login'
  | 'publicStatus'
  | 'application'
  | 'question'
  | 'questionPatch'
  | 'reorder'
  | 'position'
  | 'positionPatch'
  | 'score'
  | 'note'
  | 'settingsPatch'
  | 'decision'
  | 'notify'

let schemasPromise: Promise<Record<SchemaName, Schema>> | null = null

async function getSchemas(): Promise<Record<SchemaName, Schema>> {
  if (!schemasPromise) {
    schemasPromise = import('https://esm.sh/zod@3').then((module) => {
      const z = module.z as any
      const answerValue = z.union([
        z.string().max(4000),
        z.number(),
        z.boolean(),
        z.array(z.string().max(4000)).max(100),
      ])
      const questionFields = {
        question_text: z.string().trim().min(3).max(500),
        help_text: z.string().max(500).nullable().optional(),
        type: z.enum(QUESTION_TYPES),
        category_id: z.string().uuid().nullable().optional(),
        position_slug: z.enum(['rehber', 'aac', 'all']).nullable().optional(),
        is_required: z.boolean().optional(),
        is_active: z.boolean().optional(),
        min_length: z.number().int().min(0).max(4000).nullable().optional(),
        max_length: z.number().int().min(0).max(4000).nullable().optional(),
        min_value: z.number().nullable().optional(),
        max_value: z.number().nullable().optional(),
        sort_order: z.number().int().min(0).optional(),
        options: z
          .array(
            z.object({
              label: z.string().trim().min(1).max(200),
              value: z.string().trim().min(1).max(200),
              sort_order: z.number().int().min(0).default(0),
              is_active: z.boolean().optional(),
            }),
          )
          .max(100)
          .optional(),
      }
      return {
        login: z.object({
          username: z.string().trim().min(1).max(100),
          password: z.string().min(1).max(500),
        }),
        publicStatus: z.object({
          tracking_no: z.string().regex(/^LSC-\d{4}-[A-Z2-9]{6}$/),
          query_token: z.string().regex(/^[0-9a-fA-F]{64}$/),
        }),
        // Normalleştirilmiş başvuru gövdesi; alan adları 0001 şemasıyla birebir aynıdır.
        application: z
          .object({
            position_slug: z.enum(['rehber', 'aac']),
            applicant_minecraft_username: z.string().trim(),
            applicant_discord_username: z.string().trim(),
            age: z.number(),
            daily_hours: z.number(),
            minecraft_experience: z.string().max(4000).nullable().optional(),
            staff_experience: z.string().max(4000).nullable().optional(),
            self_introduction: z.string().max(4000).nullable().optional(),
            answers: z.union([
              z.record(answerValue),
              z.array(
                z.object({
                  question_id: z.string().uuid(),
                  value: answerValue,
                }),
              ),
            ]),
            website: z.string().max(200).optional().nullable(),
            elapsed_ms: z.number().min(0),
          })
          .refine((value: any) => isValidMinecraftUsername(value.applicant_minecraft_username), {
            message: 'Geçersiz Minecraft kullanıcı adı.',
            path: ['applicant_minecraft_username'],
          })
          .refine(
            (value: any) =>
              isValidDiscordUsername(value.applicant_discord_username) &&
              /^[A-Za-z0-9_.]{3,32}$/.test(value.applicant_discord_username),
            {
              message: 'Geçersiz Discord kullanıcı adı.',
              path: ['applicant_discord_username'],
            },
          )
          .refine((value: any) => isValidAge(value.age), {
            message: 'Yaş 10 ile 120 arasında olmalıdır.',
            path: ['age'],
          })
          .refine((value: any) => isValidHours(value.daily_hours), {
            message: 'Günlük saat 0 ile 24 arasında olmalıdır.',
            path: ['daily_hours'],
          }),
        question: z.object(questionFields),
        questionPatch: z.object(questionFields).partial(),
        reorder: z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }),
        position: z.object({
          slug: z.enum(['rehber', 'aac']),
          name: z.string().trim().min(2).max(100),
          description: z.string().max(2000).nullable().optional(),
          is_active: z.boolean().optional(),
          is_open: z.boolean().optional(),
          sort_order: z.number().int().min(0).optional(),
        }),
        positionPatch: z
          .object({
            slug: z.enum(['rehber', 'aac']).optional(),
            name: z.string().trim().min(2).max(100).optional(),
            description: z.string().max(2000).nullable().optional(),
            is_active: z.boolean().optional(),
            is_open: z.boolean().optional(),
            sort_order: z.number().int().min(0).optional(),
          })
          .refine((value: Record<string, unknown>) => Object.keys(value).length > 0, {
            message: 'Güncellenecek alan belirtilmeli.',
          }),
        score: z.object({
          application_id: z.string().uuid(),
          scores: z.record(z.number()),
          note: z.string().max(2000).optional(),
        }),
        note: z.object({
          application_id: z.string().uuid(),
          note: z.string().trim().min(1).max(2000),
        }),
        settingsPatch: z.union([
          z.object({
            settings: z.record(z.union([z.string().max(4000), z.number(), z.boolean(), z.null()])),
          }),
          z.object({
            key: z.string().trim().min(1).max(100),
            value: z.union([z.string().max(4000), z.number(), z.boolean(), z.null()]),
          }),
        ]),
        decision: z.object({
          status: z.enum(['pending', 'reviewing', 'accepted', 'rejected']),
          note: z.string().max(1000).optional(),
        }),
        notify: z.object({
          application_id: z.string().uuid().optional(),
          notification_id: z.string().uuid().optional(),
        }),
      } as Record<SchemaName, Schema>
    })
  }
  return schemasPromise
}

export type ValidationResult<T> = { ok: true; data: T } | { ok: false; error: string }

/** JSON gövdesini okur; çok büyük ve bozuk gövdeler reddedilir. */
export async function readJson(req: Request): Promise<ValidationResult<unknown>> {
  try {
    const text = await req.text()
    if (text.length > 1_000_000) return { ok: false, error: 'İstek gövdesi çok büyük.' }
    if (!text.trim()) return { ok: false, error: 'İstek gövdesi boş.' }
    return { ok: true, data: JSON.parse(text) }
  } catch {
    return { ok: false, error: 'Geçersiz JSON gövdesi.' }
  }
}

/** İsimli şemayla doğrulama yapar; hataları Türkçe, alan bazlı döndürür. */
export async function validate<T = unknown>(
  name: SchemaName,
  data: unknown,
): Promise<ValidationResult<T>> {
  try {
    const schemas = await getSchemas()
    const result = schemas[name].safeParse(data)
    if (!result.success) {
      const issues = result.error?.issues ?? []
      const detail = issues
        .map((issue) => {
          const path = (issue.path ?? []).map((part) => String(part)).join('.')
          return path ? `${path}: ${issue.message ?? 'geçersiz'}` : issue.message ?? 'geçersiz'
        })
        .slice(0, 5)
        .join(', ')
      return {
        ok: false,
        error: `Form verisi geçersiz.${detail ? ` (${detail})` : ''}`,
      }
    }
    return { ok: true, data: result.data as T }
  } catch {
    return { ok: false, error: 'Doğrulama servisi yüklenemedi.' }
  }
}

/** Takip numarası biçimini kontrol eden saf yardımcıyı yeniden dışa aktarır. */
export { isValidTrackingNo }
