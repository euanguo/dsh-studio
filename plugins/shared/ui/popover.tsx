/**
 * Popover wrapper over @base-ui/react (the shadcn base-nova primitive set
 * the project already depends on). The SINGLE floating-surface mechanism
 * for selection-action chrome (the action bar, the conversation picker and
 * the comment card): the popup floats against an anchor rect, and base-ui's
 * floating engine (floating-ui) handles side-flip / align-shift / viewport
 * clamping — no hand-rolled edge math.
 *
 * The anchor is a VIRTUAL rect (getBoundingClientRect) supplied by each call
 * site from a REAL measured element: the picker anchors to its chevron, the
 * comment card to its comment button, the action bar to the selection
 * point. Consistent call-site contract — the component itself never changes
 * behavior per surface.
 */
import { useMemo } from 'react'
import { Popover } from '@base-ui/react/popover'
import type { ReactNode } from 'react'

/** A virtual anchor: anything floating-ui can measure (getBoundingClientRect). */
export interface VirtualAnchor {
  getBoundingClientRect(): DOMRect
}

export interface FloatingLayerProps {
  /** Whether the floating layer is open. */
  open: boolean
  onOpenChange?(open: boolean): void
  /** Anchor rect in viewport coordinates (clientX/clientY origin). */
  anchor: { x: number; y: number }
  /** Preferred placement; flipping is handled by the engine. */
  side?: 'bottom' | 'top'
  align?: 'start' | 'end' | 'center'
  /** The floating content. */
  children: ReactNode
  className?: string
  /** Gap between the anchor and the popup. */
  sideOffset?: number
  /** Extra space kept from the viewport edge (flip/shift pressure). */
  collisionPadding?: number
}

export function FloatingLayer({
  open,
  onOpenChange,
  anchor,
  side = 'bottom',
  align = 'start',
  children,
  className,
  sideOffset = 6,
  collisionPadding = 12,
}: FloatingLayerProps): JSX.Element {
  const virtualAnchor = useMemo<VirtualAnchor>(() => ({
    getBoundingClientRect: () => new DOMRect(anchor.x, anchor.y, 1, 1),
  }), [anchor.x, anchor.y])
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Portal>
        <Popover.Positioner
          anchor={virtualAnchor}
          side={side}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={collisionPadding}
          className={className}
        >
          {children}
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}