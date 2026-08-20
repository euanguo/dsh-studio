import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from './cn.ts'

export type StatusLineTone = 'loading' | 'error' | 'warning' | 'neutral' | 'success'

export type StatusLineProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  tone: StatusLineTone
  children: ReactNode
  indicator?: ReactNode
  action?: ReactNode
}

/**
 * A compact live status row. It supplies ARIA semantics and layout while the
 * caller supplies any official action or status indicator.
 */
export function StatusLine({
  tone,
  children,
  indicator,
  action,
  className,
  role,
  ...props
}: StatusLineProps): JSX.Element {
  const defaultRole = tone === 'error' ? 'alert' : 'status'
  return (
    <div
      data-slot="status-line"
      data-tone={tone}
      className={cn('dsh-studio-ui-status-line', className)}
      role={role ?? defaultRole}
      {...props}
    >
      {indicator !== undefined && <span data-slot="status-line-indicator" className="dsh-studio-ui-status-line-indicator">{indicator}</span>}
      <span data-slot="status-line-message" className="dsh-studio-ui-status-line-message">{children}</span>
      {action !== undefined && <span data-slot="status-line-action" className="dsh-studio-ui-status-line-action">{action}</span>}
    </div>
  )
}
