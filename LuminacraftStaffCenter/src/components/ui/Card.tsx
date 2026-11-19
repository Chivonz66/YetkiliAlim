import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/utils'

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  footer?: ReactNode
  children?: ReactNode
}

export function Card({
  title,
  description,
  actions,
  footer,
  children,
  className,
  ...props
}: CardProps) {
  return (
    <section className={cn('panel animate-fade-up overflow-hidden', className)} {...props}>
      {(title || description || actions) && (
        <header className="flex flex-col gap-3 border-b border-white/5 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            {title && <h2 className="text-base font-semibold text-white">{title}</h2>}
            {description && <p className="mt-1 text-sm text-slate-400">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      {children && <div className="px-5 py-5">{children}</div>}
      {footer && <footer className="border-t border-white/5 bg-black/10 px-5 py-3">{footer}</footer>}
    </section>
  )
}

export default Card
