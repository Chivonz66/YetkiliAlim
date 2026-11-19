import { forwardRef, useId, type TextareaHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  hint?: string
  error?: string
  containerClassName?: string
}

const FIELD_CLASSES =
  'w-full resize-y rounded-md border border-white/10 bg-obsidian-900/80 px-3 py-2 text-sm leading-relaxed text-slate-100 placeholder:text-slate-500 transition-colors focus:border-emerald-400/60 focus:outline-none focus:ring-2 focus:ring-emerald-400/20 disabled:opacity-50 aria-[invalid=true]:border-red-400/60'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, className, containerClassName, id, rows = 4, ...props },
  ref,
) {
  const generatedId = useId()
  const textareaId = id ?? generatedId
  const hintId = `${textareaId}-hint`

  return (
    <div className={cn('w-full', containerClassName)}>
      {label && (
        <label htmlFor={textareaId} className="mb-1.5 block text-sm font-medium text-slate-300">
          {label}
          {props.required && <span className="ml-1 text-emerald-400" aria-hidden="true">*</span>}
        </label>
      )}
      <textarea
        ref={ref}
        id={textareaId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? hintId : undefined}
        className={cn(FIELD_CLASSES, error && 'border-red-400/60', className)}
        {...props}
      />
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

export default Textarea
