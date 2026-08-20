import type { HTMLAttributes } from 'react'
import { cn } from './cn.ts'

export type SeparatorProps = HTMLAttributes<HTMLDivElement> & {
  readonly orientation?: 'horizontal' | 'vertical'
  readonly decorative?: boolean
}

export function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: SeparatorProps): JSX.Element {
  return (
    <div
      data-slot="separator"
      data-orientation={orientation}
      role={decorative ? undefined : 'separator'}
      aria-orientation={decorative ? undefined : orientation}
      className={cn('dsh-studio-ui-separator', className)}
      {...props}
    />
  )
}
