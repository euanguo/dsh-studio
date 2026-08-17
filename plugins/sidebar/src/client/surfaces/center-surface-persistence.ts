/**
 * Center surface localStorage persistence (M3): a thin subscriber layer
 * over the pure-memory center surface store — mirrors every workspace's
 * open set to localStorage (debounced) and rebuilds the queues on
 * startup. Deliberately NOT zustand `persist` middleware so the identity
 * store stays pure.
 */
import { useCenterSurfaceStore } from './center-surface-store.ts'
import type { CenterSurface } from './types.ts'

const CENTER_SURFACES_STORAGE_KEY = 'oh-dsh-desktop.center-surfaces'

export interface PersistedCenterSurfaces {
  /** v3: per-workspace (cwd) tab queues. */
  version: 3
  byCwd: Record<string, {
    open: ReadonlyArray<CenterSurface>
    activeId: string | null
  }>
  /** Session tabs the user closed, per workspace; sync skips them. */
  dismissedSessions?: Record<string, string[]>
}

/** Trailing-debounce for persistence: tab bursts (open/close/preview
 *  replacement) write localStorage once, not once per store change. */
const PERSIST_DEBOUNCE_MS = 250

/** Mirror every workspace's open set to localStorage (debounced). */
export function persistCenterSurfaces(): () => void {
  let timer: number | null = null
  const stop = useCenterSurfaceStore.subscribe(() => {
    if (timer !== null) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = null
      const state = useCenterSurfaceStore.getState()
      try {
        const payload: PersistedCenterSurfaces = {
          version: 3,
          byCwd: Object.fromEntries(Object.entries(state.byCwd).map(([cwd, slice]) => [
            cwd,
            { open: slice.open, activeId: slice.activeId },
          ])),
          ...(Object.keys(state.dismissedSessions).length > 0
            ? { dismissedSessions: state.dismissedSessions }
            : {}),
        }
        window.localStorage.setItem(CENTER_SURFACES_STORAGE_KEY, JSON.stringify(payload))
      } catch {
        // Storage may be unavailable (private mode); persistence is best-effort.
      }
    }, PERSIST_DEBOUNCE_MS)
  })
  return () => {
    if (timer !== null) window.clearTimeout(timer)
    stop()
  }
}

/** Rebuild every workspace's open set from localStorage (startup). */
export function restoreCenterSurfaces(): void {
  let payload: PersistedCenterSurfaces | null = null
  try {
    const raw = window.localStorage.getItem(CENTER_SURFACES_STORAGE_KEY)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<PersistedCenterSurfaces>
      if (parsed.version === 3 && parsed.byCwd !== null && typeof parsed.byCwd === 'object') {
        payload = {
          version: 3,
          byCwd: parsed.byCwd as PersistedCenterSurfaces['byCwd'],
          ...(parsed.dismissedSessions !== null && typeof parsed.dismissedSessions === 'object'
            ? { dismissedSessions: parsed.dismissedSessions as Record<string, string[]> }
            : {}),
        }
      }
    }
  } catch (cause) {
    // Corrupt persisted state: log, drop the bad blob and start clean
    // instead of failing silently and re-persisting it forever.
    console.warn('[sidebar] clearing corrupt center-surface persistence', cause)
    try {
      window.localStorage.removeItem(CENTER_SURFACES_STORAGE_KEY)
    } catch {
      // Storage unavailable; nothing to clean.
    }
    return
  }
  if (payload === null) return
  const state = useCenterSurfaceStore.getState()
  state.clearAll()
  if (payload.dismissedSessions !== undefined) {
    useCenterSurfaceStore.setState({ dismissedSessions: payload.dismissedSessions })
  }
  for (const [cwd, entry] of Object.entries(payload.byCwd)) {
    if (!Array.isArray(entry?.open)) continue
    const open = entry.open.filter(
      (surface): surface is CenterSurface =>
        surface !== null && typeof surface === 'object' && typeof surface.id === 'string'
        && typeof surface.kind === 'string'
        && typeof surface.title === 'string'
        && typeof surface.closable === 'boolean'
        && typeof surface.isPreview === 'boolean'
        && typeof surface.cwd === 'string',
    )
    // Re-insert through the store so ids/order stay canonical.
    for (const surface of open) {
      if (surface.kind === 'conversation') {
        state.openConversation({ cwd, sessionId: surface.sessionId, title: surface.title, activate: false })
      } else if (surface.kind === 'file') {
        state.openFile({
          cwd,
          sessionId: surface.sessionId,
          filePath: surface.filePath,
          title: surface.title,
          preview: false,
          ...(surface.markdownPreview === undefined ? {} : { markdownPreview: surface.markdownPreview }),
        })
      } else if (surface.kind === 'diff') {
        state.openDiff({ cwd, sessionId: surface.sessionId, filePath: surface.filePath, staged: surface.staged, title: surface.title, preview: false })
      } else if (surface.kind === 'diff-all') {
        state.openDiffAll({ cwd, sessionId: surface.sessionId, staged: surface.staged, title: surface.title, preview: false })
      } else if (surface.kind === 'commit') {
        state.openCommit({ cwd, sessionId: surface.sessionId, hash: surface.hash, title: surface.title, preview: false })
      } else if (surface.kind === 'commit-file') {
        state.openCommitFile({ cwd, sessionId: surface.sessionId, hash: surface.hash, filePath: surface.filePath, title: surface.title, preview: false })
      } else if (surface.kind === 'committed') {
        state.openCommitted({
          cwd,
          sessionId: surface.sessionId,
          baseRef: surface.baseRef,
          ...(surface.filePath === undefined ? {} : { filePath: surface.filePath }),
          title: surface.title,
          preview: false,
        })
      } else if (surface.kind === 'conflict') {
        state.openConflict({ cwd, sessionId: surface.sessionId, filePath: surface.filePath, title: surface.title, preview: false })
      } else if (surface.kind === 'browser') {
        state.openBrowser({
          cwd,
          title: surface.title,
          ...(surface.resource === undefined ? {} : { resource: surface.resource }),
          preview: false,
        })
      } else if (surface.kind === 'terminal') {
        // Re-open the exact instance (the id is the pty's tab identity).
        state.openTerminal({ cwd, title: surface.title, id: surface.id })
      }
    }
    const activeId = open.some(surface => surface.id === entry.activeId)
      ? entry.activeId
      : open.at(-1)?.id ?? null
    if (activeId !== null) state.activate(cwd, activeId)
  }
}
