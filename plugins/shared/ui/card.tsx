import type { HTMLAttributes } from 'react'
import { cn } from './cn.ts'

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  readonly size?: 'default' | 'sm'
}

export function Card({ className, size = 'default', ...props }: CardProps): JSX.Element {
  return <div data-slot="card" data-size={size} className={cn('dsh-studio-ui-card', className)} {...props} />
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div data-slot="card-header" className={cn('dsh-studio-ui-card-header', className)} {...props} />
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div data-slot="card-title" className={cn('dsh-studio-ui-card-title', className)} {...props} />
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div data-slot="card-description" className={cn('dsh-studio-ui-card-description', className)} {...props} />
}

export function CardAction({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div data-slot="card-action" className={cn('dsh-studio-ui-card-action', className)} {...props} />
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div data-slot="card-content" className={cn('dsh-studio-ui-card-content', className)} {...props} />
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div data-slot="card-footer" className={cn('dsh-studio-ui-card-footer', className)} {...props} />
}
