import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from './cn.ts'

/**
 * One toolbar strip for every center-surface view state (file view, edit,
 * diff, preview). Owns the unified geometry — height, padding, surface,
 * divider — so switching modes never swaps chrome. Callers pass content
 * through four slots instead of building bespoke header trees:
 *
 * - `leading`: title / breadcrumb block (takes the free width).
 * - `meta`: small inline info right of the leading block.
 * - `modeSwitch`: segmented control cluster (e.g. Base UI ToggleGroup).
 * - `actions`: trailing icon/text action buttons.
 */
export interface SurfaceToolbarProps extends HTMLAttributes<HTMLDivElement> {
  readonly leading?: ReactNode
  readonly meta?: ReactNode
  readonly modeSwitch?: ReactNode
  readonly actions?: ReactNode
}

export function SurfaceToolbar({
  leading,
  meta,
  modeSwitch,
  actions,
  className,
  ...props
}: SurfaceToolbarProps): JSX.Element {
  return (
    <div className={cn('dsh-studio-ui-surface-toolbar', className)} {...props}>
      {(leading !== undefined || meta !== undefined) && (
        <span className="dsh-studio-ui-surface-toolbar-leading">
          {leading}
          {meta !== undefined && (
            <span className="dsh-studio-ui-surface-toolbar-meta">{meta}</span>
          )}
        </span>
      )}
      {modeSwitch !== undefined && (
        <span className="dsh-studio-ui-surface-toolbar-modes">{modeSwitch}</span>
      )}
      {actions !== undefined && (
        <span className="dsh-studio-ui-surface-toolbar-actions">{actions}</span>
      )}
    </div>
  )
}
