import type { HTMLAttributes } from 'react'
import { cn } from './cn.ts'

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div data-slot="skeleton" aria-hidden="true" className={cn('dsh-studio-ui-skeleton', className)} {...props} />
}
