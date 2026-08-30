import type {
  HTMLAttributes,
  LabelHTMLAttributes,
} from 'react'
import { cn } from './cn.ts'

export type FieldProps = HTMLAttributes<HTMLDivElement> & {
  readonly invalid?: boolean
  readonly disabled?: boolean
}

export function Field({ className, invalid = false, disabled = false, ...props }: FieldProps): JSX.Element {
  return (
    <div
      data-slot="field"
      data-invalid={invalid || undefined}
      data-disabled={disabled || undefined}
      className={cn('dsh-studio-ui-field', className)}
      {...props}
    />
  )
}

export function FieldLabel({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>): JSX.Element {
  return <label data-slot="field-label" className={cn('dsh-studio-ui-field-label', className)} {...props} />
}

export function FieldDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>): JSX.Element {
  return <p data-slot="field-description" className={cn('dsh-studio-ui-field-description', className)} {...props} />
}

export function FieldError({ className, children, ...props }: HTMLAttributes<HTMLParagraphElement>): JSX.Element | null {
  if (children === undefined || children === null || children === '') return null
  return (
    <p data-slot="field-error" role="alert" className={cn('dsh-studio-ui-field-error', className)} {...props}>
      {children}
    </p>
  )
}
