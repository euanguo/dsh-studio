/**
 * Desktop-shell chrome stylesheet: the one style block the native shell
 * injects into the DSH web client (`html[data-dsh-studio='true']` scope).
 *
 * Upstream pins preserved here verbatim (kernel-refactor leaf-2.1):
 * - The sidebar brand-row hiding selector anchors on the official
 *   `[data-slot='sidebar.brand.mark']` slot wrapper (5928e82).
 * - The collapsed-rail clearance re-asserts the host's
 *   `--dsh-studio-traffic-top` token at desktop-shell specificity.
 * Left-rail toggle-label semantics live in the sidebar's dsh-dom probe
 * module, not in CSS.
 */

const DESKTOP_TITLEBAR_HEIGHT = 0

const DESKTOP_CHROME_CSS = `
html[data-dsh-studio='true'] {
  /* Titlebar inset token — the renderer equivalent of the reference
     desktop distribution's --dsh-desktop-titlebar-inset. Plugins read this
     to keep their surfaces flush with the top edge. */
  --dsh-studio-titlebar-height: ${DESKTOP_TITLEBAR_HEIGHT}px;
}

html[data-dsh-studio='true'] body {
  box-sizing: border-box;
}

/* No top drag strip: the DSH conversation header is the drag region. It
   stays pinned at the top of the center column (it lives outside the
   scrollable conversation body), so the window can always be dragged by it.
   The header's interactive controls are re-enabled below. */
html[data-dsh-studio='true'] [data-slot='conversation'] header {
  -webkit-app-region: drag;
  user-select: none;
}

html[data-dsh-studio='true'] [data-slot='conversation'] header button,
html[data-dsh-studio='true'] [data-slot='conversation'] header a,
html[data-dsh-studio='true'] [data-slot='conversation'] header input,
html[data-dsh-studio='true'] [data-slot='conversation'] header select,
html[data-dsh-studio='true'] [data-slot='conversation'] header textarea,
html[data-dsh-studio='true'] [data-slot='conversation'] header [role='button'],
html[data-dsh-studio='true'] [data-slot='conversation'] header [role='link'],
html[data-dsh-studio='true'] [data-slot='conversation'] header [role='tab'],
html[data-dsh-studio='true'] [data-slot='conversation'] header [contenteditable='true'] {
  -webkit-app-region: no-drag;
  user-select: auto;
}

/* Menus are portalled to body and can geometrically overlap the conversation
   header. Electron app regions ignore normal visual stacking there, so every
   menu hit target must explicitly opt out of native window dragging. */
html[data-dsh-studio='true'] [role='menu'],
html[data-dsh-studio='true'] [role='menu'] * {
  -webkit-app-region: no-drag;
}

/* Electron drag regions ignore visual stacking: while a modal is mounted,
   suspend every renderer-owned drag target so the mask and the modal's own
   controls keep pointer input (same rule as the reference desktop
   distribution). Restoring the final modal re-enables the regions. */
html[data-dsh-studio='true']:has([aria-modal='true']) body * {
  -webkit-app-region: no-drag;
}

/* The macOS traffic lights live in the window's top-left corner (~28px);
   keep them clear of the sidebar rail's top button row. The strip itself
   is not draggable (the header is), which is fine — the traffic lights
   sit there anyway. */
html[data-dsh-studio='true'] [data-slot='sidebar'] > div {
  padding-top: 28px;
}

/* The sidebar brand row is dead chrome in the desktop shell: its whale mark
   and "deepseek" wordmark artwork (HARNESS badge drawn into the same SVG)
   are omitted, and the collapse toggle it hosts is superseded by the center
   tab strip's left-rail toggle. The row keeps its upstream fixed height
   (60px wide / 36px collapsed) even when empty, so remove the row itself.
   The selector anchors on the official slot-contract wrapper the renderer
   emits inside the row's only buttons, so it survives upstream revisions.
   Gated on the attribute the desktop shell client actually installs. */
html[data-dsh-studio-desktop='true'] [data-slot='sidebar'] div:has(
  > button [data-slot='sidebar.brand.mark']
) {
  display: none;
}

/* Collapsed-rail traffic-light clearance: the upstream collapsed root pins
   its padding with a two-class selector that out-specifies the center
   surface's [data-slot='sidebar'] > div clearance rule, so once the brand
   row is gone the rail's first button slides under the macOS traffic
   lights. Re-assert the host's --dsh-studio-traffic-top token at
   desktop-shell specificity for both rail states. */
html[data-dsh-studio-desktop='true'] [data-slot='sidebar'] > div {
  padding-top: var(--dsh-studio-traffic-top, 34px);
}
html[data-dsh-studio-preview='true'] body::after {
  content: attr(data-dsh-studio-preview-label);
  position: fixed;
  z-index: 2147483647;
  top: 7px;
  left: 50%;
  max-width: 52vw;
  padding: 4px 11px;
  overflow: hidden;
  border: 1px solid #a9c2f5;
  border-radius: 999px;
  background: #edf3ff;
  color: #28549f;
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  pointer-events: none;
  text-overflow: ellipsis;
  transform: translateX(-50%);
  white-space: nowrap;
}

html[data-dsh-studio='true'] #root:has(
  [role='presentation'] > [role='dialog']
) {
  z-index: 1000 !important;
  overflow: visible !important;
}

html[data-dsh-studio='true'] #root [role='presentation']:has(
  > [role='dialog']
) {
  z-index: 1000 !important;
  background: rgb(0 0 0 / 22%) !important;
  -webkit-backdrop-filter: blur(6px) saturate(0.9);
  backdrop-filter: blur(6px) saturate(0.9);
}


html[data-dsh-studio='true']:has(
  [role='presentation'] > [role='dialog']
) body::after,
html[data-dsh-studio='true']:has(
  [role='presentation'] > [role='dialog']
) .dsh-studio-panel-toolbar,
html[data-dsh-studio='true']:has(
  [role='presentation'] > [role='dialog']
) [data-dsh-studio-pinned-summary],
html[data-dsh-studio='true']:has(
  [role='presentation'] > [role='dialog']
) #dsh-studio-plugin-marketplace-root {
  z-index: 999 !important;
}

html[data-dsh-studio='true']:has(
  [role='presentation'] > [role='dialog']
) #dsh-studio-plugin-marketplace-root {
  position: relative;
}

`

/**
 * Install the desktop chrome stylesheet and the shell attribute gate, and
 * return the uninstaller. Upstream owns the page's document.title; the
 * native window title is derived once by the main process
 * (windowTitleForChannel), so nothing here touches titles.
 */
export function installDesktopChrome(): () => void {
  const style = document.createElement('style')
  style.dataset.dshStudioDesktopChrome = 'true'
  style.textContent = DESKTOP_CHROME_CSS
  document.head.append(style)
  document.documentElement.dataset.dshStudioDesktop = 'true'
  return () => {
    style.remove()
    delete document.documentElement.dataset.dshStudioDesktop
  }
}
