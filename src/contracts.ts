/**
 * Desktop capability contracts. The single source of truth now lives in
 * `plugins/shared/desktop-contracts.ts` so distributable plugins can import
 * the types without coupling to this repository's `src/`. This module is a
 * re-export kept for the in-repo consumers (`main.ts` / `preload.ts` /
 * `client.ts`).
 */
export * from '@dsh-studio/shared/desktop-contracts'

/* ------------------------------------------------------------------ */
/*  Upstream update lifecycle (kept from the upstream contracts.ts).    */
/* ------------------------------------------------------------------ */

export type DesktopUpdatePlatform = 'mac' | 'win' | 'appimage' | 'deb' | 'unsupported'

export type DesktopUpdateState =
  | { status: 'idle'; currentVersion: string }
  | { status: 'checking'; currentVersion: string }
  | { status: 'not-available'; currentVersion: string; checkedVersion: string }
  | { status: 'available'; currentVersion: string; latestVersion: string; releaseName: string | null; releaseNotes: string; size: number | null; platform: DesktopUpdatePlatform; releaseUrl: string }
  | { status: 'downloading'; currentVersion: string; latestVersion: string; releaseName: string | null; releaseNotes: string; size: number | null; platform: DesktopUpdatePlatform; releaseUrl: string; percent: number; transferred: number; total: number; bytesPerSecond: number; etaSeconds: number | null }
  | { status: 'downloaded'; currentVersion: string; latestVersion: string; releaseName: string | null; releaseNotes: string; size: number | null; platform: DesktopUpdatePlatform; releaseUrl: string; installOnQuit: boolean }
  | { status: 'scheduled'; currentVersion: string; latestVersion: string; releaseName: string | null; releaseNotes: string; size: number | null; platform: DesktopUpdatePlatform; releaseUrl: string }
  | { status: 'cancelled'; currentVersion: string; latestVersion?: string }
  | { status: 'unsupported'; currentVersion: string; platform: DesktopUpdatePlatform; message: string; releaseUrl: string | null }
  | { status: 'error'; currentVersion: string; stage: 'check' | 'download' | 'verify' | 'install'; code: string; message: string; releaseUrl: string | null; retryable: boolean }

export type DesktopUpdateCommand =
  | { type: 'check' }
  | { type: 'download' }
  | { type: 'cancel' }
  | { type: 'retry' }
  | { type: 'install-now' }
  | { type: 'install-on-quit' }
  | { type: 'open-release' }

/**
 * Single source of truth for the update command whitelist. Consumed by the
 * update preload (`update-preload.ts`), the main process (`main.ts`), and the
 * update manager so a newly added command type cannot be silently dropped at a
 * consumer.
 */
export const DESKTOP_UPDATE_COMMAND_TYPES = [
  'check',
  'download',
  'cancel',
  'retry',
  'install-now',
  'install-on-quit',
  'open-release',
] as const satisfies readonly DesktopUpdateCommand['type'][]

/**
 * IPC channel names, single-sourced so the preloads (`preload.ts` /
 * `update-preload.ts`) and the main process (`main.ts`) reference the same
 * literals instead of hand-writing matching strings on both ends.
 */
export const channelNames = {
  command: 'desktop:command',
  chooseWorkspace: 'desktop:choose-workspace',
  chromeGeometry: 'desktop:chrome-geometry',
  getInfo: 'desktop:get-info',
  getRuntimeSnapshot: 'desktop:get-runtime-snapshot',
  pluginMarketplaceSnapshot: 'desktop:plugin-marketplace-snapshot',
  pluginMarketplaceDispatch: 'desktop:plugin-marketplace-dispatch',
  pluginMarketplaceChanged: 'desktop:plugin-marketplace-changed',
  openExternal: 'desktop:open-external',
  updateGetState: 'desktop:update:get-state',
  updateCommand: 'desktop:update:command',
  updateState: 'desktop:update:state',
} as const

export interface DesktopUpdateBridge {
  getState(): Promise<DesktopUpdateState>
  command(command: DesktopUpdateCommand): Promise<DesktopUpdateState>
  onState(listener: (state: DesktopUpdateState) => void): () => void
}
