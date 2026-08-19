/**
 * Unified tab array reordering math (pure, unit-tested).
 *
 * Replaces the confusing multi-layer `fullTabDropIndex` + `reorderIndexAfterRemoval`
 * calculations with a single, unambiguous ID-based reordering function.
 */

export type TabDropSide = 'before' | 'after'

/**
 * Decide the drop side from the pointer's X offset within the hovered element.
 */
export function tabDropSideOf(offsetX: number, width: number): TabDropSide {
  return offsetX < width / 2 ? 'before' : 'after'
}

/**
 * Reorder an array of items with `id` by placing `sourceId` before or after `targetId`.
 * If either item is not found, or if sourceId === targetId, returns a shallow copy of the original list.
 */
export function reorderById<T extends { id: string }>(
  items: readonly T[],
  sourceId: string,
  targetId: string | null | undefined,
  side: TabDropSide = 'after',
): T[] {
  const fromIndex = items.findIndex(item => item.id === sourceId)
  if (fromIndex === -1) return [...items]

  // If dropped on empty strip area (no targetId), move to the end
  if (!targetId) {
    if (fromIndex === items.length - 1) return [...items]
    const next = [...items]
    const [item] = next.splice(fromIndex, 1)
    if (item) next.push(item)
    return next
  }

  if (sourceId === targetId) return [...items]

  const toIndex = items.findIndex(item => item.id === targetId)
  if (toIndex === -1) return [...items]

  const next = [...items]
  const [item] = next.splice(fromIndex, 1)
  if (!item) return [...items]

  // Compute insertion index after removal of source
  const targetIndexInNewArray = next.findIndex(i => i.id === targetId)
  const insertIndex = side === 'before' ? targetIndexInNewArray : targetIndexInNewArray + 1

  next.splice(insertIndex, 0, item)
  return next
}
