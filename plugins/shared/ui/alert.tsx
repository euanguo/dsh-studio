import type { HTMLAttributes } from 'react'
import { cn } from './cn.ts'

export type AlertProps = HTMLAttributes<HTMLDivElement> & {
  readonly variant?: 'default' | 'destructive'
}

export function Alert({ className, variant = 'default', ...props }: AlertProps): JSX.Element {
  return (
    <div
      data-slot="alert"
      data-variant={variant}
      role="alert"
      className={cn('dsh-studio-ui-alert', className)}
      {...props}
    />
  )
}

export function AlertTitle({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div data-slot="alert-title" className={cn('dsh-studio-ui-alert-title', className)} {...props} />
}

export function AlertDescription({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div data-slot="alert-description" className={cn('dsh-studio-ui-alert-description', className)} {...props} />
}

export function AlertAction({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div data-slot="alert-action" className={cn('dsh-studio-ui-alert-action', className)} {...props} />
}
