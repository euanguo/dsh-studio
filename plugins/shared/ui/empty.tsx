import type { HTMLAttributes } from 'react'
import { cn } from './cn.ts'

export function Empty({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div data-slot="empty" className={cn('dsh-studio-ui-empty', className)} {...props} />
}

export function EmptyHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div data-slot="empty-header" className={cn('dsh-studio-ui-empty-header', className)} {...props} />
}

export type EmptyMediaProps = HTMLAttributes<HTMLDivElement> & {
  readonly variant?: 'default' | 'icon'
}

export function EmptyMedia({ className, variant = 'default', ...props }: EmptyMediaProps): JSX.Element {
  return (
    <div
      data-slot="empty-media"
      data-variant={variant}
      className={cn('dsh-studio-ui-empty-media', className)}
      {...props}
    />
  )
}

export function EmptyTitle({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div data-slot="empty-title" className={cn('dsh-studio-ui-empty-title', className)} {...props} />
}

export function EmptyDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>): JSX.Element {
  return <p data-slot="empty-description" className={cn('dsh-studio-ui-empty-description', className)} {...props} />
}

export function EmptyContent({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div data-slot="empty-content" className={cn('dsh-studio-ui-empty-content', className)} {...props} />
}
