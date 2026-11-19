import { Check, CircleDashed } from 'lucide-react'
import { cn } from '../../lib/utils'

export interface ProgressStepperProps {
  steps: string[]
  currentStep: number
  completedSteps?: number[]
  percentage?: number
}

/** Başvuru sihirbazının ilerleme göstergesi; tamamlanma yüzdesini de bildirir. */
export function ProgressStepper({
  steps,
  currentStep,
  completedSteps = [],
  percentage,
}: ProgressStepperProps) {
  const completed = new Set(completedSteps)
  const progress = percentage ?? (steps.length > 0 ? Math.round((completed.size / steps.length) * 100) : 0)

  return (
    <section aria-label="Başvuru ilerlemesi" className="panel px-4 py-4 sm:px-6 sm:py-5">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-emerald-350 uppercase">
            Başvuru ilerlemesi
          </p>
          <p className="mt-1 text-sm text-slate-300">
            Adım {Math.min(currentStep + 1, steps.length)} / {steps.length}
          </p>
        </div>
        <span className="font-mono text-lg font-semibold text-emerald-300" aria-hidden="true">
          %{progress}
        </span>
      </div>

      <div
        role="progressbar"
        aria-label="Tamamlanma yüzdesi"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.max(0, progress))}
        className="h-1.5 w-full overflow-hidden rounded-full bg-white/5"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-350 transition-[width] duration-500 ease-out"
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </div>

      <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, index) => {
          const isDone = completed.has(index) || index < currentStep
          const isActive = index === currentStep
          return (
            <li key={`${step}-${index}`} className="flex min-w-0 items-center gap-2.5">
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border font-mono text-xs transition-colors',
                  isDone && 'border-emerald-400/40 bg-emerald-400/15 text-emerald-300',
                  isActive && !isDone && 'border-cyan-350/50 bg-cyan-350/10 text-cyan-200',
                  !isActive && !isDone && 'border-white/10 bg-white/5 text-slate-500',
                )}
              >
                {isDone ? <Check size={15} /> : isActive ? <CircleDashed size={15} /> : index + 1}
              </span>
              <span
                className={cn(
                  'truncate text-xs leading-tight',
                  isActive ? 'font-semibold text-white' : isDone ? 'text-slate-300' : 'text-slate-500',
                )}
                aria-current={isActive ? 'step' : undefined}
              >
                {step}
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export default ProgressStepper
