import type { TextareaHTMLAttributes } from 'react'

import { cn } from './cn.ts'

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>

/** ShadCN textarea source component with DSW token-backed chrome. */
export function Textarea({ className, ...props }: TextareaProps): JSX.Element {
  return (
    <textarea
      data-slot="textarea"
      className={cn('dsh-studio-ui-textarea', className)}
      {...props}
    />
  )
}
