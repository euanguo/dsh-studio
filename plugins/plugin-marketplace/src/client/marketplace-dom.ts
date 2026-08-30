/**
 * marketplace-dom.ts (leaf-4.2 / C4)
 * =====================================================================
 * The ONLY module in this plugin that probes the DSH web client's upstream
 * DOM. Every selector / `data-slot` / aria-* / `role` below is an upstream
 * pin: after a DSH UI revision you re-anchor ONLY this file to re-pin the
 * whole plugin. Never spell these selectors inline in feature code (gate G2
 * enforces the boundary).
 *
 * COUPLING NOTES (pinned to the Settings shell, rc.x):
 *  - The rail settings trigger carries a `[data-slot="settings.trigger"]`
 *    slot marker inside its content (rc.x renders trigger content in a slot).
 *  - The settings trigger to be used lives inside a `[data-slot="sidebar"]`
 *    ancestor (the open settings panel may render a second, off-context copy).
 *  - Collapsed-rail fallback: the icon-only trigger is the sidebar's
 *    `button[aria-haspopup="dialog"]`, sorted to the rail foot.
 *  - An open settings dialog is `[role="dialog"][aria-modal="true"]` whose
 *    aria-label / labelled element / leading textContent contains
 *    "settings" or "设置".
 *  - The marketplace footer stack lives at the nearest ancestor of
 *    `.oh-marketplace-nav` (the nav entry injected into the sidebar footer);
 *    it is tagged with a data-attribute so CSS can switch it to a column.
 * ---------------------------------------------------------------------
 */

/** Marker put on the footer stack to switch it to a column layout. */
export const FOOTER_STACK_ATTRIBUTE = 'data-dsh-studio-marketplace-footer-stack'

/** Renders a button inside `[data-slot="sidebar"]` (upstream rail shell). */
const SIDEBAR_SLOT = '[data-slot="sidebar"]'

/**
 * Live settings trigger in the sidebar rail, skipping hidden copies.
 * Three upstream pin strategies in order: slot marker inside sidebar →
 * accessible settings label → collapsed-rail icon dialog-opener.
 */
export function settingsButton(): HTMLButtonElement | null {
  const visible = (button: HTMLButtonElement): boolean => {
    const rect = button.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }
  const findByBottom = (left: HTMLButtonElement, right: HTMLButtonElement): number =>
    right.getBoundingClientRect().bottom - left.getBoundingClientRect().bottom

  // rc.x wraps the trigger content in a stable slot marker; the rail trigger
  // is the one inside the sidebar (the open settings panel may render a copy).
  const slotted = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find(button => button.querySelector('[data-slot="settings.trigger"]') !== null
      && button.closest(SIDEBAR_SLOT) !== null
      && visible(button))
  if (slotted !== undefined) return slotted

  // Accessible-label fallback: any visible settings-labelled button.
  const labeled = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .filter(button => {
      if (!visible(button)) return false
      const label = [
        button.textContent,
        button.getAttribute('aria-label'),
        button.getAttribute('title'),
      ].filter(Boolean).join(' ').trim().toLowerCase()
      return label.includes('settings') || label.includes('设置')
    })
  if (labeled.length > 0) return labeled.sort(findByBottom)[0] ?? null

  // rc.x collapsed rail: icon-only dialog-opener at the rail foot.
  const railTriggers = [...document.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="dialog"]')]
    .filter(button => button.closest(SIDEBAR_SLOT) !== null && visible(button))
  return railTriggers.sort(findByBottom)[0] ?? null
}

/** True when a settings dialog is currently open (label / locale pinned). */
export function settingsDialogOpen(): boolean {
  return [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')]
    .some(dialog => {
      const labelledBy = dialog.getAttribute('aria-labelledby')
      const label = [
        dialog.getAttribute('aria-label'),
        labelledBy === null ? null : document.getElementById(labelledBy)?.textContent,
        dialog.textContent?.slice(0, 80),
      ].filter(Boolean).join(' ').trim().toLowerCase()
      return label.includes('settings') || label.includes('设置')
    })
}

/** The footer stack ancestor that holds both the nav entry and settings. */
export function marketplaceFooterStack(settings: HTMLElement): HTMLElement | null {
  const navigation = document.querySelector<HTMLElement>('.oh-marketplace-nav')
  if (navigation === null) return null
  let candidate = navigation.parentElement
  while (candidate !== null && candidate !== document.body) {
    if (candidate.contains(settings)) return candidate
    candidate = candidate.parentElement
  }
  return null
}

/** Observe root: `document.body` — the minimum that also sees the settings
 *  dialog, which the host portals to `body` (outside the sidebar rail). */
function observeScope(): Node | null {
  return document.body
}

export interface DomObserverHandle {
  disconnect(): void
}

/**
 * Watch the upstream DOM for changes that could have moved the settings
 * trigger or opened/closed a settings dialog (C39).
 *
 * Scope: a single `childList` observer on `document.body` (subtree). This is
 * the smallest window that still catches the website-owned settings dialog,
 * which the host portals to `body`. We deliberately listen to `childList`
 * only (no attribute/characterData churn, e.g. CSS-derived class toggles).
 *
 * Dirty-check caching — the cost collapse vs the old two full-document scans
 * per mutation:
 *   - Coalescing: multiple mutations in one frame notify `onChange` exactly
 *     once (a dirty check on the pending-animation-frame flag).
 *   - The two expensive probes are now caller-gated: the full-document
 *     `settingsDialogOpen()` scan runs only while the marketplace modal is
 *     open (see marketplace-view.tsx), and geometry settling early-returns
 *     through `applyFooterStackMarker` when the footer target is unchanged.
 */
export function observeMarketplaceDom(
  onChange: () => void,
): DomObserverHandle {
  const scope = observeScope()
  let frame: number | null = null
  const coalesced = (): void => {
    if (frame === null) {
      frame = requestAnimationFrame(() => {
        frame = null
        onChange()
      })
    }
  }
  const observer = new MutationObserver(coalesced)
  if (scope !== null) {
    observer.observe(scope, { childList: true, subtree: true })
  }
  let isDisconnected = false
  return {
    disconnect: () => {
      if (isDisconnected) return
      isDisconnected = true
      if (frame !== null) cancelAnimationFrame(frame)
      observer.disconnect()
    },
  }
}

/**
 * Toggle a footer stack's column-layout marker on/off. Returns whether the
 * attribution changed so callers can skip work (dirty check).
 */
export function applyFooterStackMarker(
  footerStack: HTMLElement | null,
  previous: HTMLElement | null,
): HTMLElement | null {
  if (footerStack === previous) return previous
  previous?.removeAttribute(FOOTER_STACK_ATTRIBUTE)
  footerStack?.setAttribute(FOOTER_STACK_ATTRIBUTE, 'true')
  return footerStack
}

/** Resolve the bounded viewport used by the official ScrollArea primitive. */
export function resolveMarketplaceScrollViewport(node: HTMLDivElement | null): HTMLDivElement | null {
  return node?.closest<HTMLDivElement>('.dsh-studio-ui-scroll-area-viewport')
    ?? node?.querySelector<HTMLDivElement>('.dsh-studio-ui-scroll-area-viewport')
    ?? node
}

/** Identify an upstream settings-button click for the modal auto-close rule. */
export function isSettingsButtonClick(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('button') === settingsButton()
}
