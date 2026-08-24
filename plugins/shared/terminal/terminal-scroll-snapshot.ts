/**
 * Terminal scroll buffer snapshot and scroll intent restoration (ported from
 * orca's `terminal-scroll-buffer-snapshot.ts` and `pane-scroll.ts`).
 *
 * Captures the terminal's viewport position before a fit/reflow and restores
 * it after — keeping the user pinned to the line they were inspecting instead
 * of snapping to the top/bottom on every width change.
 */

export type TerminalScrollBufferType = 'normal' | 'alternate'

export interface TerminalScrollSnapshot {
  bufferType: TerminalScrollBufferType
  viewportY: number
  baseY: number
  wasAtBottom: boolean
}

export type TerminalScrollTarget = {
  buffer?: {
    active?: {
      type?: string
      viewportY?: number
      baseY?: number
      length?: number
    }
  }
  scrollToBottom?: () => void
  scrollToLine?: (line: number) => void
}

export function readTerminalScrollBufferSnapshot(
  terminal: TerminalScrollTarget,
): { bufferType: TerminalScrollBufferType; viewportY: number; baseY: number } | null {
  const active = terminal.buffer?.active
  if (!active) return null
  const viewportY = active.viewportY
  const baseY = active.baseY
  if (typeof viewportY !== 'number' || typeof baseY !== 'number') return null
  if (!Number.isFinite(viewportY) || !Number.isFinite(baseY)) return null
  return {
    bufferType: active.type === 'alternate' ? 'alternate' : 'normal',
    viewportY,
    baseY,
  }
}

export function isTerminalViewportAtBottom(terminal: TerminalScrollTarget): boolean {
  const snapshot = readTerminalScrollBufferSnapshot(terminal)
  if (!snapshot) return true
  return snapshot.viewportY >= snapshot.baseY
}

export function clampTerminalViewportY(
  terminal: TerminalScrollTarget,
  viewportY: number,
): number {
  const snapshot = readTerminalScrollBufferSnapshot(terminal)
  if (!snapshot) return 0
  return Math.max(0, Math.min(snapshot.baseY, Math.floor(viewportY)))
}

/** Capture scroll state before fit/reflow. */
export function captureTerminalScrollState(
  terminal: TerminalScrollTarget,
): TerminalScrollSnapshot | null {
  const snapshot = readTerminalScrollBufferSnapshot(terminal)
  if (!snapshot) return null
  return {
    ...snapshot,
    wasAtBottom: snapshot.viewportY >= snapshot.baseY,
  }
}

/** Restore scroll state after fit/reflow: pinned users stay pinned, users
 *  following the tail stay at the bottom. */
export function restoreTerminalScrollState(
  terminal: TerminalScrollTarget,
  snapshot: TerminalScrollSnapshot | null,
): void {
  if (!snapshot) return
  try {
    if (snapshot.wasAtBottom) {
      terminal.scrollToBottom?.()
      return
    }
    const targetY = clampTerminalViewportY(terminal, snapshot.viewportY)
    terminal.scrollToLine?.(targetY)
  } catch {
    // Terminal may not be measurable during an unmount / hidden switch.
  }
}