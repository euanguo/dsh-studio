/**
 * Window-chrome geometry → CSS variables for the unified top rail.
 *
 * The strip's left reservation (`--oh-dsh-traffic-left`) comes from the
 * Electron main process on macOS (the traffic-light anchor is only known
 * there — `trafficLightPosition`); the right reservation
 * (`--oh-dsh-traffic-right`) comes from the live Window Controls Overlay
 * API on Windows (the overlay caption row's control-button region, which
 * moves/resizes with the window and fires `geometrychange`). Outside the
 * desktop both variables keep their CSS fallbacks (74px / 8px).
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

/** Apply the chrome geometry once; returns the disposer (HMR-safe). */
export function applyChromeGeometry(): () => void {
  const root = document.documentElement
  const setVar = (name: string, value: string): void => {
    root.style.setProperty(name, value)
  }

  // macOS: the traffic-light anchor comes from the main process (the renderer
  // cannot measure system-drawn controls). Width = anchor x + cluster width.
  const bridge = (window as { dshDesktop?: DesktopBridgeLike }).dshDesktop
  if (bridge?.chrome !== undefined) {
    void bridge.chrome.getGeometry().then(geometry => {
      if (geometry.trafficLight !== null) {
        setVar('--oh-dsh-traffic-left', `${String(geometry.trafficLight.x + geometry.trafficLightWidth)}px`)
      }
    }).catch(() => {
      // Keep the CSS fallback (74px).
    })
  }

  // Windows: the overlay caption row's control-button region lives at the
  // top-right; reserve its width so the strip's right-end controls never
  // tuck under the minimize/maximize/close buttons. Follows the window live.
  const wco = (navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlayLike }).windowControlsOverlay
  if (wco !== undefined && typeof wco.getTitlebarAreaRect === 'function') {
    const sync = (): void => {
      const rect = wco.getTitlebarAreaRect!()
      if (rect !== undefined && rect !== null && rect.width > 0) {
        setVar('--oh-dsh-traffic-right', `${String(Math.round(rect.width))}px`)
      }
    }
    sync()
    wco.addEventListener?.('geometrychange', sync)
    return () => { wco.removeEventListener?.('geometrychange', sync) }
  }

  return () => {}
}
