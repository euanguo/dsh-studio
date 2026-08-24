/**
 * Desktop-only capability contracts, shared by the desktop add-on (Electron
 * preload) and the plugins that consume them. The generic sidebar treats
 * these as optional — `window.dshDesktop` is undefined outside the desktop —
 * so every member must be optional-chained at the call site.
 *
 * Kept in @dsh-studio/shared so plugins can reference the contracts without
 * importing the desktop app's `src/` (which would couple a distributable
 * plugin to this repository's root).
 */

/** Commands sent from Electron's native chrome to the DSH client plugin. */
export type DesktopCommand =
  | { type: 'focus-composer' }
  | { type: 'new-session' }
  | { type: 'open-paths'; paths: string[] }
  | { type: 'show-settings' }
  | { type: 'toggle-bottom-panel' }
  | { type: 'toggle-panel-maximized' }
  | { type: 'toggle-pinned-summary' }
  | { type: 'toggle-side-panel' }
  | { type: 'toggle-workspace-panel' }
  | { type: 'open-browser' }
  | { type: 'open-files' }
  | { type: 'open-review' }
  | { type: 'open-side-chat' }
  | { type: 'open-trajectory' }
  | { type: 'toggle-sidebar' }

/** Public facts exposed by the isolated Electron preload. */
export interface DesktopInfo {
  appDataPath: string
  channel: 'stable' | 'dev'
  dshHome: string
  platform: NodeJS.Platform
  preview: { pluginId: string; transactionId: string } | null
  profile: string
  version: string
}

/** Window-chrome geometry the renderer needs for the unified top rail. */
export interface ChromeGeometry {
  platform: NodeJS.Platform
  /** macOS traffic-light anchor (the BrowserWindow trafficLightPosition). */
  trafficLight: { x: number; y: number } | null
  /** Exact traffic-light cluster width: three 12px buttons with 8px gaps
   *  (Apple HIG) = 52px. Deterministic — the buttons are system-drawn at
   *  fixed positions relative to our own anchor. */
  trafficLightWidth: number
  /** System traffic-light button diameter in CSS px, supplied by main. */
  trafficLightHeight: number
}

/** Runtime diagnostics shown by the bundled bottom-panel plugin. */
export interface DesktopRuntimeSnapshot {
  bundledPlugins: string[]
  logTail: string[]
  profile: string
  runtimeUrl: string | null
  status: 'ready' | 'restarting' | 'stopped'
}

/** Browser-safe desktop bridge made available through contextBridge. */
export interface DesktopBridge {
  chooseWorkspace(): Promise<string[]>
  getInfo(): Promise<DesktopInfo>
  getRuntimeSnapshot(): Promise<DesktopRuntimeSnapshot>
  onCommand(listener: (command: DesktopCommand) => void): () => void
  openExternal(url: string): Promise<void>
  /**
   * Window-chrome geometry for top-rail layout (traffic lights on macOS,
   * the live window-control overlay on Windows). Optional at the call site
   * like every bridge member — absent outside the desktop.
   */
  chrome: {
    getGeometry(): Promise<ChromeGeometry>
  }
  /**
   * Marketplace bridge, structurally narrowed so shared does not import the
   * marketplace protocol types. Consumers that need the precise command /
   * snapshot types narrow the result at their call site.
   */
  pluginMarketplace: {
    dispatch(command: unknown): Promise<unknown>
    getSnapshot(): Promise<unknown>
  }
}
