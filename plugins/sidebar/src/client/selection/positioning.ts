/**
 * Shared viewport-safe positioning for floating surfaces that anchor to a
 * screen coordinate (a text-selection point, a hovered row, …) rather than
 * to a DOM element. Replaces hand-rolled `left/top` calculations that could
 * push a surface past the viewport edge (the "组件撞到边缘被遮挡" report).
 *
 * The returned rect flips below→above when there is no room under the
 * anchor, right→left against the right edge, and clamps inside the viewport
 * with a margin. Both the action bar and the comment card use this.
 */

export interface AnchorPoint {
  x: number
  y: number
}

export interface ClampOptions {
  /** Margin kept from every viewport edge (px). */
  margin?: number
  /** Preferred vertical placement: below the anchor (default) or above. */
  side?: 'bottom' | 'top'
}

export interface ClampedRect {
  left: number
  top: number
}

/** Flip a bottom placement to top when the remaining room is too small. */
export function chooseVerticalSide(
  anchorY: number,
  surfaceHeight: number,
  viewportHeight: number,
  margin = 8,
): 'bottom' | 'top' {
  const below = viewportHeight - anchorY - margin
  return below >= surfaceHeight || below >= anchorY - margin ? 'bottom' : 'top'
}

/**
 * Compute a viewport-safe fixed position for a floating surface of
 * `surfaceWidth`×`surfaceHeight` anchored at `point`.
 */
export function clampSurfacePosition(
  point: AnchorPoint,
  surfaceWidth: number,
  surfaceHeight: number,
  options: ClampOptions = {},
): ClampedRect {
  const { margin = 8, side = 'bottom' } = options
  const vw = window.innerWidth
  const vh = window.innerHeight
  const top = side === 'top'
    ? point.y - surfaceHeight - margin
    : point.y + margin
  // Flip to the top when the surface would run off the bottom.
  const effectiveTop = side === 'bottom' && top + surfaceHeight > vh - margin
    ? Math.max(margin, point.y - surfaceHeight - margin)
    : Math.max(margin, Math.min(top, vh - surfaceHeight - margin))
  const left = Math.max(
    margin,
    Math.min(point.x, vw - surfaceWidth - margin),
  )
  return { left, top: effectiveTop }
}

/**
 * Measure the surface once via a hidden probe node and return its rect, so
 * callers can clamp before paint. Returns null while the probe is missing.
 */
export function measureAndClamp(
  point: AnchorPoint,
  element: HTMLElement | null,
  options: ClampOptions = {},
): ClampedRect | null {
  if (element === null) return null
  const w = element.offsetWidth
  const h = element.offsetHeight
  const side = options.side
    ?? chooseVerticalSide(point.y, h, window.innerHeight, options.margin)
  return clampSurfacePosition(point, w, h, { ...options, side })
}