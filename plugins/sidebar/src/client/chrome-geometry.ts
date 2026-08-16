/**
 * Window-chrome geometry → CSS variables for the unified top rail.
 *
 * ONE rule for every full-window top row (the center strip and the right
 * panel's top row), measured live:
 * - left pad  = content start next to the macOS traffic lights
 *   (anchor x + exact cluster width — 3×12px buttons, 8px gaps, Apple HIG,
 *   deterministic from our own trafficLightPosition — + breathing gap)
 *   minus the element's own left offset (the DSH collapsed rail pushes
 *   the strip right, the side panel may be side-by-side), clamped ≥ 8px;
 * - right pad = the live Window Controls Overlay control region on
 *   Windows (window width minus the overlay rect's right edge) minus the
 *   element's own right offset, clamped ≥ 8px — so the strip/panel
 *   right-end controls never tuck under minimize/maximize/close.
 *
 * Variables (all set on documentElement; CSS keeps the fallbacks):
 * - `--oh-dsh-traffic-left`: absolute content start (diagnostics);
 * - `--oh-dsh-traffic-pad-l` / `--oh-dsh-traffic-pad-r`: the STRIP's
 *   effective left/right padding;
 * - `--oh-dsh-side-pad-l` / `--oh-dsh-side-pad-r`: the right panel top
 *   row's effective left/right padding.
 * Outside the desktop every variable keeps its CSS fallback.
 */
import type { ChromeGeometry } from '../../../shared/desktop-contracts.ts'

/** The WCO surface as Chromium exposes it on Electron 42 (macOS returns an
 *  empty rect and visible=false — only Windows/Linux report the overlay). */
interface WindowControlsOverlayLike {
  getTitlebarAreaRect?(): DOMRect
  addEventListener?(type: 'geometrychange', listener: () => void): void
  removeEventListener?(type: 'geometrychange', listener: () => void): void
}

interface DesktopBridgeLike {
  chrome?: {
    getGeometry(): Promise<ChromeGeometry>
  }
}

/** Minimum breathing padding for every top-row element (matches
 *  `--oh-dsh-space-2`). */
const BASE_PAD = 8
/** Breathing room between the traffic lights and the first control
 *  (matches the macOS titlebar convention). */
const TRAFFIC_LIGHT_GAP = 8

/** Apply the chrome geometry once; returns the disposer (HMR-safe). */
export function applyChromeGeometry(): () => void {
  const root = document.documentElement
  const setVar = (name: string, value: string): void => {
    root.style.setProperty(name, value)
  }

  /** Absolute content start next to the traffic lights, in px from the
   *  window's left edge. Falls back to 74 (macOS default) until the main
   *  process answers; on platforms without traffic lights it becomes 0. */
  let contentStart = 74
  /** Windows overlay control region, in px from the window's right edge
   *  (0 on macOS — the system-drawn lights live top-left only). */
  let rightReserve = 0

  // macOS: the traffic-light anchor comes from the main process (the
  // renderer cannot measure system-drawn controls). Cluster width is exact:
  // three 12px buttons with 8px gaps (Apple HIG).
  const bridge = (window as { dshDesktop?: DesktopBridgeLike }).dshDesktop
  if (bridge?.chrome !== undefined) {
    void bridge.chrome.getGeometry().then(geometry => {
      if (geometry.trafficLight !== null) {
        contentStart = geometry.trafficLight.x + geometry.trafficLightWidth + TRAFFIC_LIGHT_GAP
      } else {
        // Windows/Linux: no system-drawn controls on the left — the top
        // rows need no left reservation (the caption lives top-right).
        contentStart = 0
      }
      setVar('--oh-dsh-traffic-left', `${contentStart}px`)
      resyncAll()
    }).catch(() => {
      // Keep the CSS fallbacks.
    })
  }

  // Windows: the overlay caption row's control buttons sit at the
  // top-right corner; the overlay rect is the SAFE content area (window
  // width minus the control region), so the right reservation is the
  // remainder. Follows geometrychange + window resize.
  const wco = (navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlayLike }).windowControlsOverlay
  const syncRight = (): void => {
    if (wco === undefined || typeof wco.getTitlebarAreaRect !== 'function') return
    const rect = wco.getTitlebarAreaRect!()
    if (rect !== undefined && rect !== null && rect.width > 0) {
      rightReserve = Math.max(0, window.innerWidth - (rect.x + rect.width))
    }
  }
  const syncRightAndAll = (): void => {
    syncRight()
    resyncAll()
  }

  /** Compute one top-row element's effective pads: the chrome reservation
   *  minus the element's own offset, clamped to the base padding. The
   *  measurement box is the PANEL when present — never the row itself, so
   *  the row's own padding (which these vars feed) cannot feed back into
   *  the measurement. Skipped while a side-panel row's panel is closed
   *  (its rect is an off-screen sliver — the pads would be garbage; the
   *  next open recomputes them). */
  const updateElement = (element: HTMLElement, varLeft: string, varRight: string): void => {
    const panel = element.closest<HTMLElement>('.oh-dsh-workspace-panel')
    if (panel !== null && panel.getAttribute('data-open') !== 'true') return
    const box = panel ?? element
    const rect = box.getBoundingClientRect()
    const padLeft = Math.max(BASE_PAD, contentStart - rect.left)
    setVar(varLeft, `${Math.round(padLeft)}px`)
    const padRight = Math.max(BASE_PAD, rightReserve - (window.innerWidth - rect.right))
    setVar(varRight, `${Math.round(padRight)}px`)
  }

  // Track the two top rows so their pads follow rail/window/panel changes:
  // a ResizeObserver per element fires when the DSH rail expands/collapses
  // (the strip's box changes) or the panel switches overlay/side-by-side,
  // and one on the root covers window resizes. The right panel slides and
  // maximizes with CSS TRANSFORMS — which ResizeObserver never sees — so
  // the pads are also recomputed when the panel's transitions/animations
  // end and when its data-open/data-maximized attributes flip. Elements
  // that mount later are picked up by the wait observer below.
  const tracked = new Set<HTMLElement>()
  const observers: ResizeObserver[] = []
  const cleanupPanelListeners: Array<() => void> = []
  const attachPanelListeners = (panel: HTMLElement): void => {
    const onAnimationEnd = (): void => { resyncAll() }
    panel.addEventListener('transitionend', onAnimationEnd)
    panel.addEventListener('animationend', onAnimationEnd)
    const attributeObserver = new MutationObserver(resyncAll)
    attributeObserver.observe(panel, { attributes: true, attributeFilter: ['data-open', 'data-maximized', 'style', 'class'] })
    cleanupPanelListeners.push(() => {
      panel.removeEventListener('transitionend', onAnimationEnd)
      panel.removeEventListener('animationend', onAnimationEnd)
      attributeObserver.disconnect()
    })
  }
  const track = (selector: string, varLeft: string, varRight: string): void => {
    const element = document.querySelector<HTMLElement>(selector)
    if (element === null || tracked.has(element)) return
    tracked.add(element)
    const panel = element.closest<HTMLElement>('.oh-dsh-workspace-panel')
    if (panel !== null) attachPanelListeners(panel)
    const observer = new ResizeObserver(() => {
      updateElement(element, varLeft, varRight)
    })
    observer.observe(element)
    observer.observe(root)
    observers.push(observer)
    updateElement(element, varLeft, varRight)
  }
  const resyncAll = (): void => {
    track('.oh-dsh-center-tabs-strip', '--oh-dsh-traffic-pad-l', '--oh-dsh-traffic-pad-r')
    track('.oh-dsh-side-top', '--oh-dsh-side-pad-l', '--oh-dsh-side-pad-r')
  }
  const waitObserver = new MutationObserver(resyncAll)
  waitObserver.observe(document.body, { childList: true, subtree: true })
  resyncAll()

  syncRight()
  if (wco !== undefined && typeof wco.addEventListener === 'function') {
    wco.addEventListener('geometrychange', syncRightAndAll)
  }

  return () => {
    waitObserver.disconnect()
    for (const observer of observers) observer.disconnect()
    for (const cleanup of cleanupPanelListeners) cleanup()
    if (wco !== undefined && typeof wco.removeEventListener === 'function') {
      wco.removeEventListener('geometrychange', syncRightAndAll)
    }
  }
}
