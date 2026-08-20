import { useId, type HTMLAttributes, type ReactNode } from 'react'
import { cn } from './cn.ts'
import { Field, FieldDescription, FieldLabel } from './field.tsx'

/**
 * A DSH General-row field with copy on the left and an official control on the
 * right. The control remains owned by the caller; this module owns only the
 * row geometry and Field semantics.
 */
export type SettingsRowProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  title: ReactNode
  description?: ReactNode
  control: ReactNode
  htmlFor?: string
  disabled?: boolean
}

export function SettingsRow({
  title,
  description,
  control,
  htmlFor,
  disabled = false,
  className,
  ...props
}: SettingsRowProps): JSX.Element {
  const labelId = useId()
  return (
    <Field
      data-slot="settings-row"
      disabled={disabled}
      className={cn('dsh-studio-ui-settings-row', className)}
      {...props}
    >
      <div className="dsh-studio-ui-settings-row-layout">
        <div className="dsh-studio-ui-settings-row-copy">
          {htmlFor === undefined ? (
            <div id={labelId} data-slot="settings-row-label" className="dsh-studio-ui-field-label">{title}</div>
          ) : (
            <FieldLabel id={labelId} htmlFor={htmlFor}>{title}</FieldLabel>
          )}
          {description !== undefined && description !== null && description !== '' && (
            <FieldDescription>{description}</FieldDescription>
          )}
        </div>
        <div
          role="group"
          aria-labelledby={labelId}
          className="dsh-studio-ui-settings-row-control"
        >
          {control}
        </div>
      </div>
    </Field>
  )
}
