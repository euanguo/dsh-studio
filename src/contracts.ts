/**
 * Desktop capability contracts. The single source of truth now lives in
 * `plugins/shared/desktop-contracts.ts` so distributable plugins can import
 * the types without coupling to this repository's `src/`. This module is a
 * re-export kept for the in-repo consumers (`main.ts` / `preload.ts` /
 * `client.ts`).
 */
export * from '@oh-dsh/shared/desktop-contracts'

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

export interface DesktopUpdateBridge {
  getState(): Promise<DesktopUpdateState>
  command(command: DesktopUpdateCommand): Promise<DesktopUpdateState>
  onState(listener: (state: DesktopUpdateState) => void): () => void
}
