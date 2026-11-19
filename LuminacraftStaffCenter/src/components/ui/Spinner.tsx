import type { SVGProps } from 'react'
import { cn } from '../../lib/utils'

export interface SpinnerProps extends Omit<SVGProps<SVGSVGElement>, 'size'> {
  size?: number
  label?: string
}

export function Spinner({ size = 20, label = 'Yükleniyor', className, ...props }: SpinnerProps) {
  return (
    <svg
      role="status"
      aria-label={label}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={cn('inline-block animate-spin text-emerald-400', className)}
      {...props}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}

export default Spinner
