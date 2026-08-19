/**
 * Center surface localStorage persistence (M3): a thin subscriber layer
 * over the pure-memory center surface store — mirrors every workspace's
 * open set to localStorage (debounced) and rebuilds the queues on
 * startup. Deliberately NOT zustand `persist` middleware so the identity
 * store stays pure.
 *
 * The center surfaces are project-dimension (keyed by cwd), and the open
 * set is a WHITELIST: only conversations the user has open (or files/diffs
 * they pinned) persist. Closing an open tab removes it from the queue and
 * the persisted document — next restart restores exactly what was left
 * open. A conversation is an ordinary center tab: closing it never archives
 * the session; the session stays in the session list and clicking it in the
 * left rail re-opens its tab.
 */
import { useCenterSurfaceStore } from './center-surface-store.ts'
import type { CenterSurface } from './types.ts'

const CENTER_SURFACES_STORAGE_KEY = 'oh-dsh-desktop.center-surfaces.v2'

export interface PersistedCenterSurfaces {
  /** v4: per-workspace (cwd) tab queues, project dimension, no session
   *  blacklist. */
  version: 4
  byCwd: Record<string, {
    open: ReadonlyArray<CenterSurface>
    activeId: string | null
  }>
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
          version: 4,
          byCwd: Object.fromEntries(Object.entries(state.byCwd).map(([cwd, slice]) => [
            cwd,
            { open: slice.open, activeId: slice.activeId },
          ])),
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
      if (parsed.version === 4 && parsed.byCwd !== null && typeof parsed.byCwd === 'object') {
        payload = {
          version: 4,
          byCwd: parsed.byCwd as PersistedCenterSurfaces['byCwd'],
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
    // Re-insert through the store so ids/order stay canonical. The open set
    // is a whitelist: only the surface objects persisted were open — a
    // closed conversation is simply absent, so it never comes back.
    for (const surface of open) {
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
