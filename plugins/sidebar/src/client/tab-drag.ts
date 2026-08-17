/**
 * Tab drag payload + drop-position helpers for the right rail ↔ bottom
 * workbench moves (HTML5 drag & drop). Pure string/geometry math so the
 * unit tests cover the payload round-trip and the before/after decision
 * without a DOM.
 */
import type { SidebarTabDragPayload } from './contract.ts'

export type { SidebarTabDragPayload } from './contract.ts'

/** The dataTransfer slot carrying {@link SidebarTabDragPayload}. */
export const TAB_DRAG_MIME = 'application/x-oh-dsh-tab'

/** Serialize a drag payload into the dataTransfer slot. */
export function serializeTabDrag(payload: SidebarTabDragPayload): string {
  return JSON.stringify(payload)
}

/** Parse a dataTransfer slot back into a payload; garbage → null. */
export function parseTabDrag(raw: string | undefined): SidebarTabDragPayload | null {
  if (raw === undefined) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return null
    const value = parsed as Partial<SidebarTabDragPayload>
    if (value.kind !== 'sidebar-tab' || typeof value.tabId !== 'string') return null
    if (value.source !== 'side' && value.source !== 'bottom') return null
    return { kind: 'sidebar-tab', tabId: value.tabId, source: value.source }
  } catch {
    return null
  }
}

/** Where a drop lands relative to the hovered chip: before or after it. */
export type TabDropSide = 'before' | 'after'

/**
 * Decide the drop side from the pointer's X offset within the hovered chip
 * (the left half drops before, the right half after).
 */
export function tabDropSideOf(offsetX: number, width: number): TabDropSide {
  return offsetX < width / 2 ? 'before' : 'after'
}

/**
 * Map a drop between two VISIBLE strip chips back to an index in the FULL
 * tab array. The right rail hides the pinned tabs (files / review), so the
 * chip the pointer hovers is found by id and its REAL full-array position
 * becomes the insert index (before → the chip's index, after → +1) —
 * interleaved pinned tabs stay put because the full array keeps its order.
 */
export function fullTabDropIndex(
  tabs: readonly { id: string; type: string }[],
  hiddenTypes: ReadonlySet<string>,
  hoverId: string,
  side: TabDropSide,
): number {
  const visible = tabs.filter(tab => !hiddenTypes.has(tab.type))
  if (!visible.some(tab => tab.id === hoverId)) return tabs.length
  const hover = tabs.findIndex(tab => tab.id === hoverId)
  return side === 'before' ? hover : hover + 1
}

/**
 * The insert index after REMOVING the dragged item itself: when the item
 * sits before the drop target, removing it shifts the target down by one.
 */
export function reorderIndexAfterRemoval(from: number, target: number): number {
  return from < target ? target - 1 : target
}