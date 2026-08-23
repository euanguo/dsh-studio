import { Button, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TooltipSide } from '@deepseek-ai/dsh-client-ui-primitives'
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from './cn.ts'

/**
 * An icon-only toolbar action backed by the official DSH toolbar button. The
 * required label supplies both the tooltip and the accessible name.
 */
export type ToolbarActionProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: ReactNode
  label: string
  pressed?: boolean | undefined
  /** Official Button family. Geometry is the compact square icon form
   *  (see `dsh-studio-ui-toolbar-action` in ui.css), so both map to the
   *  same 26×26 seat; `ghost` (default) stays quiet at rest, `toolbar`
   *  keeps the constant fill for strips that want it. */
  variant?: 'toolbar' | 'ghost' | undefined
  /** Tooltip placement; toolbar strips default to below the button, where the
   *  bubble never slides back over the anchor at a viewport edge. */
  tooltipSide?: TooltipSide | undefined
}

/** Ref forwards to the Tooltip anchor element wrapping the button — same box
 *  geometry, so menu anchors can read its rect. (The official Button does not
 *  forward refs itself.) */
export const ToolbarAction = forwardRef<HTMLElement, ToolbarActionProps>(
  function ToolbarAction(
    {
      icon,
      label,
      pressed,
      variant = 'ghost',
      tooltipSide = 'bottom',
      className,
      disabled,
      ...props
    },
    ref,
  ) {
    const button = (
      <Button
        {...props}
        variant={variant}
        size="sm"
        icon={icon}
        className={cn('dsh-studio-ui-toolbar-action', className)}
        data-slot="toolbar-action"
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
      />
    )
    const anchor = (
      <span ref={ref} className="dsh-studio-ui-toolbar-action-anchor">{button}</span>
    )
    return disabled === undefined
      ? <Tooltip label={label} side={tooltipSide}>{anchor}</Tooltip>
      : <Tooltip label={label} side={tooltipSide} disabled={disabled}>{anchor}</Tooltip>
  },
)
