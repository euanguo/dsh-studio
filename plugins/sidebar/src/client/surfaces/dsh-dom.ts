/**
 * The only file that touches DSH's internal DOM shapes: the center column,
 * the left-rail toggle and the obfuscated fallback class all live here so
 * the rest of the sidebar never spells DSH selectors inline.
 *
 * Coupling notes (kept intentionally tight):
 * - The center column is located via the stable `[data-slot="conversation"]`
 *   slot's parent; the obfuscated `.aOBRAa_centerCol` class is only a
 *   fallback when the slot is absent (non-conversation pages).
 * - The left-rail toggle is identified by the sidebar slot + its localized
 *   aria-label flip (收起/展开). DSH changes to either would surface here
 *   first.
 */

/** DSH center column (flex-col container holding the conversation slot). */
export function centerColumnElement(): HTMLElement | null {
  const conversationSlot = document.querySelector('[data-slot="conversation"]')
  if (conversationSlot?.parentElement instanceof HTMLElement) {
    return conversationSlot.parentElement
  }
  return document.querySelector<HTMLElement>('.aOBRAa_centerCol')
}

/** DSH left-rail toggle button (aria-label flips between 收起/展开侧边栏). */
export function leftRailToggleButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(
    '[data-slot="sidebar"] button[aria-label*="侧边栏"]',
  )
}

/**
 * Whether the DSH left rail is currently expanded (null when unknown).
 * The DSH toggle's aria-label describes the ACTION it performs — it reads
 * "收起侧边栏" / "Collapse sidebar" while the rail is EXPANDED (clicking
 * collapses it) and "展开侧边栏" / "Expand sidebar" while it is collapsed.
 */
export function readLeftRailOpen(): boolean | null {
  const label = leftRailToggleButton()?.getAttribute('aria-label')
  if (label === undefined || label === null || label === '') return null
  return label.includes('收起') || /collapse/i.test(label)
}
