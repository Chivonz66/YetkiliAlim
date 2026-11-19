import { forwardRef, useId, type ReactNode, type SelectHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  hint?: string
  error?: string
  options?: SelectOption[]
  placeholder?: string
  containerClassName?: string
  children?: ReactNode
}

const FIELD_CLASSES =
  'w-full appearance-none rounded-md border border-white/10 bg-obsidian-900/80 px-3 py-2 text-sm text-slate-100 transition-colors focus:border-emerald-400/60 focus:outline-none focus:ring-2 focus:ring-emerald-400/20 disabled:opacity-50 aria-[invalid=true]:border-red-400/60'

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    hint,
    error,
    options,
    placeholder,
    className,
    containerClassName,
    children,
    id,
    ...props
  },
  ref,
) {
  const generatedId = useId()
  const selectId = id ?? generatedId
  const hintId = `${selectId}-hint`

  return (
    <div className={cn('w-full', containerClassName)}>
      {label && (
        <label htmlFor={selectId} className="mb-1.5 block text-sm font-medium text-slate-300">
          {label}
          {props.required && <span className="ml-1 text-emerald-400" aria-hidden="true">*</span>}
        </label>
      )}
      <select
        ref={ref}
        id={selectId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? hintId : undefined}
        className={cn(FIELD_CLASSES, error && 'border-red-400/60', className)}
        {...props}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options?.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
        {children}
      </select>
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

export default Select
