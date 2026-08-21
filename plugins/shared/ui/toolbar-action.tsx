import { Button, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TooltipSide } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from './cn.ts'

/**
 * An icon-only toolbar action backed by the official DSH toolbar button. The
 * required label supplies both the tooltip and the accessible name.
 */
export type ToolbarActionProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: ReactNode
  label: string
  pressed?: boolean
  /** Tooltip placement; toolbar strips default to below the button, where the
   *  bubble never slides back over the anchor at a viewport edge. */
  tooltipSide?: TooltipSide
}

export function ToolbarAction({
  icon,
  label,
  pressed,
  tooltipSide = 'bottom',
  className,
  disabled,
  ...props
}: ToolbarActionProps): JSX.Element {
  const button = (
    <Button
      {...props}
      variant="toolbar"
      size="sm"
      icon={icon}
      className={cn('dsh-studio-ui-toolbar-action', className)}
      data-slot="toolbar-action"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
    />
  )
  const anchor = <span className="dsh-studio-ui-toolbar-action-anchor">{button}</span>
  return disabled === undefined
    ? <Tooltip label={label} side={tooltipSide}>{anchor}</Tooltip>
    : <Tooltip label={label} side={tooltipSide} disabled={disabled}>{anchor}</Tooltip>
}
