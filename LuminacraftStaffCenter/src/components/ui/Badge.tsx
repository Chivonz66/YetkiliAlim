import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/utils'

export type BadgeVariant =
  | 'default'
  | 'pending'
  | 'reviewing'
  | 'accepted'
  | 'rejected'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  children?: ReactNode
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: 'border-white/10 bg-white/5 text-slate-300',
  pending: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  reviewing: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200',
  accepted: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  success: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  rejected: 'border-red-400/30 bg-red-400/10 text-red-200',
  danger: 'border-red-400/30 bg-red-400/10 text-red-200',
  warning: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  info: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200',
}

export function Badge({ variant = 'default', className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        VARIANT_CLASSES[variant],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
}

export default Badge
