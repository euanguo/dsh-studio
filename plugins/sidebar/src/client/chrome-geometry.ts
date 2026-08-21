/**
 * Window-chrome geometry → CSS variables for the unified top rail.
 *
 * Deliberately STATELESS: the top rows' reservations are decided by app
 * state (left rail collapsed/expanded, panel full-width), never by
 * measuring elements — see center-surface.css and side-tools.css for
 * those state-driven rules. This module only publishes the two raw
 * chrome facts the renderer cannot know on its own:
 *
 * - `--dsh-studio-traffic-left`: the macOS content start next to the traffic
 *   lights = anchor x + exact cluster width (3×12px buttons, 8px gaps —
 *   Apple HIG, deterministic from our own trafficLightPosition) +
 *   breathing gap. Set once from the main process; 0 on platforms
 *   without left-side system controls (the caption lives top-right).
 * - `--dsh-studio-traffic-right`: the live Window Controls Overlay control
 *   region on Windows (window width minus the overlay rect's right edge
 *   — the rect is the SAFE content area), following `geometrychange`
 *   while the window moves/resizes. 0 on macOS.
 *
 * Outside the desktop both variables keep their CSS fallbacks.
 */
import type { ChromeGeometry } from '@dsh-studio/shared/desktop-contracts'

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

/** Breathing room between the traffic lights and the first control
 *  (matches the macOS titlebar convention). */
const TRAFFIC_LIGHT_GAP = 8

/** Apply the chrome geometry once; returns the disposer (HMR-safe). */
export function applyChromeGeometry(): () => void {
  const root = document.documentElement
  const setVar = (name: string, value: string): void => {
    root.style.setProperty(name, value)
  }

  // macOS: the traffic-light anchor comes from the main process (the
  // renderer cannot measure system-drawn controls). Cluster width is exact:
  // three 12px buttons with 8px gaps (Apple HIG).
  const bridge = (window as { dshDesktop?: DesktopBridgeLike }).dshDesktop
  if (bridge?.chrome !== undefined) {
    void bridge.chrome.getGeometry().then(geometry => {
      const contentStart = geometry.trafficLight === null
        ? 0
        : geometry.trafficLight.x + geometry.trafficLightWidth + TRAFFIC_LIGHT_GAP
      setVar('--dsh-studio-traffic-left', `${contentStart}px`)
      // Full vertical clearance under the lights (anchor + button + gap):
      // columns that start at x=0 (the DSH left rail) pad their header down
      // by this so the whale mark never collides with the system controls.
      const topClearance = geometry.trafficLight === null
        ? '0px'
        : `${String(geometry.trafficLight.y + geometry.trafficLightHeight + TRAFFIC_LIGHT_GAP)}px`
      setVar('--dsh-studio-traffic-top', topClearance)
    }).catch(() => {
      // Keep the CSS fallbacks.
    })
  }

  // Windows: the overlay caption row's control buttons sit at the
  // top-right corner; the overlay rect is the SAFE content area (window
  // width minus the control region), so the right reservation is the
  // remainder. Follows geometrychange (fires on move/resize).
  const wco = (navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlayLike }).windowControlsOverlay
  const syncRight = (): void => {
    if (wco === undefined || typeof wco.getTitlebarAreaRect !== 'function') return
    const rect = wco.getTitlebarAreaRect!()
    if (rect !== undefined && rect !== null && rect.width > 0) {
      setVar('--dsh-studio-traffic-right', `${String(Math.max(0, window.innerWidth - (rect.x + rect.width)))}px`)
    }
  }
  syncRight()
  if (wco !== undefined && typeof wco.addEventListener === 'function') {
    wco.addEventListener('geometrychange', syncRight)
  }

  return () => {
    if (wco !== undefined && typeof wco.removeEventListener === 'function') {
      wco.removeEventListener('geometrychange', syncRight)
    }
  }
}
