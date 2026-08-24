/**
 * Domain-backed persistence for center-surface queues. The identity store stays
 * pure memory; this layer restores and saves the complete per-cwd open set.
 */
import {
  UI_CHROME_TABLES,
} from '@dsh-studio/shared/ui-chrome-tables'
import { createUiChromeStorage } from '@dsh-studio/shared/ui-chrome-storage'
import { useCenterSurfaceStore } from './center-surface-store.ts'
import type { CenterSurface } from './types.ts'

export interface PersistedCenterSurfaces {
  byCwd: Record<string, {
    open: ReadonlyArray<CenterSurface>
    activeId: string | null
  }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isSurfaceBase(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && typeof value.id === 'string' && value.id !== ''
    && typeof value.cwd === 'string' && value.cwd !== ''
    && typeof value.title === 'string'
    && value.closable === true
}

function isCenterSurface(value: unknown): value is CenterSurface {
  if (!isSurfaceBase(value) || typeof value.kind !== 'string') return false
  switch (value.kind) {
    case 'conversation':
      return typeof value.sessionId === 'string' && value.sessionId !== '' && value.isPreview === false
    case 'file':
      return typeof value.filePath === 'string' && typeof value.isPreview === 'boolean'
        && (value.markdownPreview === undefined || typeof value.markdownPreview === 'boolean')
    case 'diff':
      return typeof value.filePath === 'string' && typeof value.staged === 'boolean' && typeof value.isPreview === 'boolean'
    case 'diff-all':
      return typeof value.staged === 'boolean' && typeof value.isPreview === 'boolean'
    case 'commit':
      return typeof value.hash === 'string' && typeof value.isPreview === 'boolean'
    case 'commit-file':
      return typeof value.hash === 'string' && typeof value.filePath === 'string' && typeof value.isPreview === 'boolean'
    case 'committed':
      return typeof value.baseRef === 'string' && typeof value.isPreview === 'boolean'
        && (value.filePath === undefined || typeof value.filePath === 'string')
    case 'conflict':
      return typeof value.filePath === 'string' && typeof value.isPreview === 'boolean'
    case 'browser':
      return typeof value.isPreview === 'boolean'
        && (value.resource === undefined || typeof value.resource === 'string')
    case 'terminal':
      return value.isPreview === false
    default:
      return false
  }
}

/** Drop malformed rows so one bad persisted tab never blocks restoration. */
export function sanitizePersistedCenterSurfaces(value: unknown): PersistedCenterSurfaces {
  const byCwdValue = isRecord(value) && isRecord(value.byCwd) ? value.byCwd : {}
  const byCwd: PersistedCenterSurfaces['byCwd'] = {}
  for (const [cwd, entry] of Object.entries(byCwdValue)) {
    if (cwd === '' || !isRecord(entry) || !Array.isArray(entry.open)) continue
    const open = entry.open.filter(isCenterSurface)
    const activeId = typeof entry.activeId === 'string' && open.some(surface => surface.id === entry.activeId)
      ? entry.activeId
      : null
    byCwd[cwd] = { open, activeId }
  }
  return { byCwd }
}

const storage = createUiChromeStorage<PersistedCenterSurfaces>({
  table: UI_CHROME_TABLES.centerSurfaces,
  defaults: () => ({ byCwd: {} }),
  sanitize: sanitizePersistedCenterSurfaces,
  debounceMs: 250,
})

let hydrated = false
let applyingRestore = false
let changedBeforeHydrate = false

function payloadOf(): PersistedCenterSurfaces {
  const state = useCenterSurfaceStore.getState()
  return {
    byCwd: Object.fromEntries(Object.entries(state.byCwd).map(([cwd, slice]) => [
      cwd,
      { open: slice.open, activeId: slice.activeId },
    ])),
  }
}

/** Preserve surfaces opened while the asynchronous domain read was pending. */
export function mergePayloads(
  stored: PersistedCenterSurfaces,
  current: PersistedCenterSurfaces,
): PersistedCenterSurfaces {
  const byCwd: PersistedCenterSurfaces['byCwd'] = { ...stored.byCwd }
  for (const [cwd, currentSlice] of Object.entries(current.byCwd)) {
    const storedSlice = byCwd[cwd]
    if (storedSlice === undefined) {
      byCwd[cwd] = currentSlice
      continue
    }
    const open = [...storedSlice.open]
    for (const surface of currentSlice.open) {
      const index = open.findIndex(candidate => candidate.id === surface.id)
      if (index < 0) open.push(surface)
      else open[index] = surface
    }
    byCwd[cwd] = {
      open,
      activeId: currentSlice.activeId !== null && open.some(surface => surface.id === currentSlice.activeId)
        ? currentSlice.activeId
        : storedSlice.activeId,
    }
  }
  return { byCwd }
}

/** Mirror every workspace open-set after the initial asynchronous hydrate. */
export function persistCenterSurfaces(): () => void {
  hydrated = false
  changedBeforeHydrate = false
  const stop = useCenterSurfaceStore.subscribe(() => {
    if (applyingRestore) return
    if (hydrated) storage.save(payloadOf())
    else changedBeforeHydrate = true
  })
  return () => {
    stop()
    hydrated = false
    void storage.flush()
  }
}

/** Rebuild every workspace open-set from the domain store at startup. */
export async function restoreCenterSurfaces(): Promise<void> {
  const stored = await storage.load()
  const pending = payloadOf()
  const payload = changedBeforeHydrate
    ? mergePayloads(stored, pending)
    : stored
  applyingRestore = true
  try {
    const state = useCenterSurfaceStore.getState()
    state.clearAll()
    for (const [cwd, entry] of Object.entries(payload.byCwd)) {
      state.ensureCwd(cwd)
      for (const surface of entry.open) {
        if (surface.kind === 'conversation') {
          state.openConversation({ cwd, sessionId: surface.sessionId, title: surface.title, activate: false })
        } else if (surface.kind === 'file') {
          state.openFile({
            cwd,
            filePath: surface.filePath,
            title: surface.title,
            preview: false,
            ...(surface.markdownPreview === undefined ? {} : { markdownPreview: surface.markdownPreview }),
          })
        } else if (surface.kind === 'diff') {
          state.openDiff({ cwd, filePath: surface.filePath, staged: surface.staged, title: surface.title, preview: false })
        } else if (surface.kind === 'diff-all') {
          state.openDiffAll({ cwd, staged: surface.staged, title: surface.title, preview: false })
        } else if (surface.kind === 'commit') {
          state.openCommit({ cwd, hash: surface.hash, title: surface.title, preview: false })
        } else if (surface.kind === 'commit-file') {
          state.openCommitFile({ cwd, hash: surface.hash, filePath: surface.filePath, title: surface.title, preview: false })
        } else if (surface.kind === 'committed') {
          state.openCommitted({
            cwd,
            baseRef: surface.baseRef,
            ...(surface.filePath === undefined ? {} : { filePath: surface.filePath }),
            title: surface.title,
            preview: false,
          })
        } else if (surface.kind === 'conflict') {
          state.openConflict({ cwd, filePath: surface.filePath, title: surface.title, preview: false })
        } else if (surface.kind === 'browser') {
          state.openBrowser({
            cwd,
            title: surface.title,
            ...(surface.resource === undefined ? {} : { resource: surface.resource }),
            preview: false,
          })
        } else if (surface.kind === 'terminal') {
          state.openTerminal({ cwd, title: surface.title, id: surface.id })
        }
      }
      const activeId = entry.open.some(surface => surface.id === entry.activeId)
        ? entry.activeId
        : entry.open.at(-1)?.id ?? null
      if (activeId !== null) state.activate(cwd, activeId)
    }
  } finally {
    applyingRestore = false
  }
  hydrated = true
  if (changedBeforeHydrate) {
    changedBeforeHydrate = false
    storage.save(payloadOf())
  }
}
