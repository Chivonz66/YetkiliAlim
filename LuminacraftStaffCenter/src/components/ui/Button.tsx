import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  loading?: boolean
  fullWidth?: boolean
  icon?: ReactNode
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'border-emerald-400/40 bg-emerald-400/15 text-emerald-200 hover:bg-emerald-400/25 hover:text-emerald-100',
  secondary:
    'border-white/10 bg-white/5 text-slate-200 hover:border-cyan-300/30 hover:bg-cyan-300/10 hover:text-white',
  ghost: 'border-transparent bg-transparent text-slate-300 hover:bg-white/5 hover:text-white',
  danger:
    'border-red-400/40 bg-red-500/15 text-red-200 hover:bg-red-500/25 hover:text-red-100',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    loading = false,
    fullWidth = false,
    icon,
    className,
    children,
    disabled,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-semibold transition-all duration-200',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT_CLASSES[variant],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {loading ? <Spinner size={16} label="İşleniyor" /> : icon}
      {children}
    </button>
  )
})

export default Button
