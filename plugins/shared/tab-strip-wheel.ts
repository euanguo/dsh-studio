/**
 * Tab-strip wheel scrolling helpers.
 *
 * A plain mouse wheel emits deltaY, which an `overflow-x` container never
 * consumes natively. These helpers turn the wheel over a surface tab strip
 * into horizontal scrolling, shared by the center strip and the right panel
 * tab row. Everything here is pure DOM-agnostic logic (the only DOM
 * touchpoint is {@link bindTabStripWheel}, which stays tiny) so the unit
 * tests cover the policy without mounting React or a browser.
 */

/** Modifier keys keep their native meaning on the tab strip (shift =
 *  horizontal scroll, ctrl/cmd = zoom); the strip must not hijack them. */
export function hasTabStripWheelModifier(event: {
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}): boolean {
  return event.shiftKey || event.ctrlKey || event.metaKey || event.altKey
}

/** Convert a native wheel `deltaMode` to a pixel delta (0 = pixels, 1 =
 *  lines → 16px per notch, 2 = pages → the container width). */
export function tabStripWheelDelta(
  deltaMode: number,
  deltaX: number,
  deltaY: number,
  clientWidth: number,
): number {
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? clientWidth : 1
  return (deltaX + deltaY) * unit
}

/** The DOM shape the scroller resolver reads (property-only, so tests use
 *  plain object graphs). */
export interface TabStripScrollElement {
  scrollWidth: number
  clientWidth: number
  scrollLeft: number
  parentElement: TabStripScrollElement | null
}

/**
 * The effective horizontal scroller for a tab strip: the element itself
 * when it overflows, otherwise the nearest ancestor that does. The center
 * surface wraps the strip in its own scroller while the right panel scrolls
 * the strip wrapper directly — binding the listener on the strip and
 * resolving per event covers both hosts without duplicating layout. An
 * element whose scroller is absent (nothing overflows) yields null.
 */
export function resolveTabStripScroller(el: TabStripScrollElement): TabStripScrollElement | null {
  let current: TabStripScrollElement | null = el
  while (current !== null) {
    if (current.scrollWidth > current.clientWidth) return current
    current = current.parentElement
  }
  return null
}

/**
 * Bind the non-passive wheel handler that scrolls the tab strip
 * horizontally. React registers `onWheel` passively at the root, where
 * `preventDefault()` is a no-op, so this uses a native listener. Modifier
 * keys and non-overflowing strips are left alone (the page scrolls
 * normally). Returns the disposer.
 */
export function bindTabStripWheel(el: HTMLElement): () => void {
  const onWheel = (event: WheelEvent): void => {
    if (hasTabStripWheelModifier(event)) return
    const scroller = resolveTabStripScroller(el)
    if (scroller === null) return
    event.preventDefault()
    scroller.scrollLeft += tabStripWheelDelta(
      event.deltaMode,
      event.deltaX,
      event.deltaY,
      scroller.clientWidth,
    )
  }
  el.addEventListener('wheel', onWheel, { passive: false })
  return () => { el.removeEventListener('wheel', onWheel) }
}