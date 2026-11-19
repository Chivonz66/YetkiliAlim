import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../../lib/utils'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: string
  error?: string
  suffix?: ReactNode
  containerClassName?: string
}

const FIELD_CLASSES =
  'w-full rounded-md border border-white/10 bg-obsidian-900/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 transition-colors focus:border-emerald-400/60 focus:outline-none focus:ring-2 focus:ring-emerald-400/20 disabled:opacity-50 aria-[invalid=true]:border-red-400/60'

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, suffix, className, containerClassName, id, ...props },
  ref,
) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const hintId = `${inputId}-hint`

  return (
    <div className={cn('w-full', containerClassName)}>
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-slate-300">
          {label}
          {props.required && <span className="ml-1 text-emerald-400" aria-hidden="true">*</span>}
        </label>
      )}
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? hintId : undefined}
          className={cn(
            FIELD_CLASSES,
            Boolean(suffix) && 'pr-10',
            error && 'border-red-400/60',
            className,
          )}
          {...props}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-500">
            {suffix}
          </span>
        )}
      </div>
      {(error || hint) && (
        <p
          id={hintId}
          className={cn('mt-1.5 text-xs', error ? 'text-red-300' : 'text-slate-500')}
          role={error ? 'alert' : undefined}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  )
})

export default Input
