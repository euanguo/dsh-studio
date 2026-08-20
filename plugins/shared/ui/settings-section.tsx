import { useId, type HTMLAttributes, type ReactNode } from 'react'
import { cn } from './cn.ts'

/**
 * General settings section wrapper. It owns section heading rhythm but does
 * not impose a card, grid, or feature-specific background.
 */
export type SettingsSectionProps = Omit<HTMLAttributes<HTMLElement>, 'title' | 'children'> & {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}

export function SettingsSection({
  title,
  description,
  actions,
  children,
  className,
  ...props
}: SettingsSectionProps): JSX.Element {
  const titleId = useId()
  return (
    <section
      {...props}
      data-slot="settings-section"
      aria-labelledby={titleId}
      className={cn('dsh-studio-ui-settings-section', className)}
    >
      <header className="dsh-studio-ui-settings-section-header">
        <div className="dsh-studio-ui-settings-section-copy">
          <h3 id={titleId} className="dsh-studio-ui-settings-section-title">{title}</h3>
          {description !== undefined && description !== null && description !== '' && (
            <p className="dsh-studio-ui-settings-section-description">{description}</p>
          )}
        </div>
        {actions !== undefined && <div className="dsh-studio-ui-settings-section-actions">{actions}</div>}
      </header>
      {children}
    </section>
  )
}
