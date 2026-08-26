/**
 * The only file that touches DSH's internal DOM shapes: the center column,
 * the left-rail toggle, the Settings rail trigger and the obfuscated fallback
 * class all live here so the rest of the sidebar never spells DSH selectors
 * inline.
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

/**
 * The DSH left sidebar container (`[data-slot="sidebar"]`). The center-surface
 * host observes only this subtree (not the whole body) so chat streaming does
 * not trigger full-page re-scans; the collapsed-path toggle's MutationObserver
 * lives here too (C5). Coupling: the stable sidebar slot id.
 */
export function leftSidebarElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-slot="sidebar"]')
}

/**
 * Whether the DSH app is currently rendering a dark theme. DSH sets
 * `data-ds-dark-theme` on `<body>` when dark, and Pierre's `github-light` /
 * `github-dark` theme maps onto that flag (C6). The pierre adapter consults
 * this instead of spelling the attribute inline.
 */
export function isDshDarkTheme(): boolean {
  return typeof document !== 'undefined' && document.body?.dataset.dsDarkTheme !== undefined
}

/**
 * Subscribe to DSH app-theme changes so a consumer (e.g. the pierre diff
 * worker) can re-resolve its light/dark theme when the app flips. Observes
 * only the `data-ds-dark-theme` attribute on `<body>` (C6). Returns an
 * unsubscribe function.
 */
export function subscribeDshDarkTheme(onChange: () => void): () => void {
  if (typeof document === 'undefined' || document.body === null) return () => {}
  const observer = new MutationObserver(onChange)
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
  return () => { observer.disconnect() }
}

/**
 * Candidate aria-labels for the DSH left-rail toggle, in both the shipped
 * Chinese and English localizations. The label describes the ACTION the
 * button performs — "收起侧边栏"/"Collapse sidebar" while the rail is
 * EXPANDED (clicking collapses it), "打开侧边栏"/"Open sidebar" while it
 * is collapsed (the upstream `sidebar` dictionary's `toggle.open`; the
 * shell never says "展开" there). Matching any candidate finds the button
 * regardless of the active locale (C8: the old probe hard-coded the Chinese
 * substring and found nothing in English environments).
 */
export const LEFT_RAIL_TOGGLE_LABELS: readonly string[] = [
  '收起侧边栏',
  '收起',
  '展开侧边栏',
  '展开',
  '打开侧边栏',
  'Collapse sidebar',
  'Collapse',
  'Expand sidebar',
  'Expand',
  'Open sidebar',
]

function matchesToggleLabel(label: string): boolean {
  const lower = label.toLowerCase()
  return LEFT_RAIL_TOGGLE_LABELS.some(candidate => lower.includes(candidate.toLowerCase()))
}

/** DSH left-rail toggle button (aria-label flips between collapse/expand). */
export function leftRailToggleButton(): HTMLButtonElement | null {
  const buttons = document.querySelectorAll<HTMLButtonElement>('[data-slot="sidebar"] button')
  for (const button of buttons) {
    const label = button.getAttribute('aria-label') ?? ''
    if (matchesToggleLabel(label)) return button
  }
  return null
}

/**
 * Whether the DSH left rail is currently expanded (null when unknown).
 * The DSH toggle's aria-label describes the ACTION it performs — it reads
 * "收起侧边栏" / "Collapse sidebar" while the rail is EXPANDED (clicking
 * collapses it) and "展开侧边栏" / "Expand sidebar" while it is collapsed.
 * Both localizations are matched (C8).
 */
export function readLeftRailOpen(): boolean | null {
  const label = leftRailToggleButton()?.getAttribute('aria-label')
  if (label === undefined || label === null || label === '') return null
  return label.includes('收起') || /collapse/i.test(label)
}

/**
 * The DSH conversation Trajectory tab (role="tab"); identified by localized
 * text among the caller-supplied candidate labels (the translated word plus
 * known upstream spellings). Upstream DOM/wording changes surface here.
 */
export function trajectoryTabButton(
  candidateLabels: readonly string[],
): HTMLButtonElement | null {
  const wanted = new Set(
    candidateLabels.map(label => label.trim().toLowerCase()).filter(Boolean),
  )
  const tabs = document.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  for (const element of tabs) {
    const label = element.textContent?.trim().toLowerCase() ?? ''
    if (wanted.has(label)) return element
  }
  return null
}

/**
 * Whether an upstream menu or dialog is currently open (`[role="menu"],
 * `[role="dialog"]`). The files explorer consults this so its F2/Delete
 * keyboard shortcuts stay inert while Chrome's own overlay is active (C5).
 * Coupling: the ARIA roles are stable upstream; an upstream re-slotting of
 * menu/dialog surfaces re-pins here, not in the files tree.
 */
export function hasOpenMenuOrDialog(): boolean {
  if (typeof document === 'undefined') return false
  return document.querySelector('[role="menu"], [role="dialog"]') !== null
}

/**
 * The upstream Settings trigger in the sidebar rail, located so the desktop
 * shell's native "show settings" command can open the DSH Settings shell.
 * Relocated verbatim from src/client.ts (kernel-refactor leaf-2.1): this is
 * the one module allowed to pin upstream selectors, and no official
 * programmatic "open settings" API exists in the pinned client, so clicking
 * the real trigger remains the only path.
 *
 * Coupling notes (pinned to the Settings shell):
 * - The trigger content carries a stable `[data-slot="settings.trigger"]`
 *   slot marker; the rail copy is the one inside a `[data-slot="sidebar"]`
 *   ancestor (an open settings panel renders its own second copy).
 * - Fallback 1: any button whose text / aria-label / title reads
 *   "settings" or "设置" (both shipped localizations).
 * - Fallback 2 (collapsed rail): the icon-only trigger is the sidebar's
 *   bottom-most `button[aria-haspopup="dialog"]`.
 */
export function settingsTriggerButton(): HTMLButtonElement | null {
  const slotted = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find(button => button.querySelector('[data-slot="settings.trigger"]') !== null
      && button.closest('[data-slot="sidebar"]') !== null)
  if (slotted !== undefined) return slotted
  const labeled = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find(button => /settings|设置/i.test([
      button.textContent,
      button.getAttribute('aria-label'),
      button.getAttribute('title'),
    ].filter(Boolean).join(' ')))
  if (labeled !== undefined) return labeled
  return [...document.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="dialog"]')]
    .filter(button => button.closest('[data-slot="sidebar"]') !== null)
    .sort((left, right) => right.getBoundingClientRect().bottom - left.getBoundingClientRect().bottom)[0]
    ?? null
}
