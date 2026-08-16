/**
 * Center surface store (ported from the reference project's
 * `surfaces/center-surface-store.ts`, adapted to per-workspace slices).
 *
 * The center open-set identity owner, keyed by WORKSPACE (cwd): every
 * workspace keeps its own tab queue (session conversations + open
 * file/diff/browser/terminal surfaces), so switching workspaces swaps the
 * whole queue — the same way the Git panel and file list follow the cwd.
 *
 * Preview/pin semantics (the single implementation point is
 * `openPreviewableSurface`):
 * - single click (`preview: true`, default) replaces the current preview tab
 *   — at most ONE preview tab exists at a time;
 * - double click / explicit open (`preview: false`) pins the tab;
 * - conversations and terminals are always pinned (`isPreview: false`).
 *
 * Persistence: the store itself is pure memory. A thin subscriber layer
 * (see `persistCenterSurfaces`) mirrors every workspace's queue to
 * localStorage and rebuilds them on startup — deliberately NOT zustand
 * `persist` middleware so the identity store stays pure.
 */
import { create } from 'zustand'
import {
  browserSurfaceId,
  commitFileSurfaceId,
  commitSurfaceId,
  committedSurfaceId,
  conflictSurfaceId,
  CONVERSATION_SURFACE_PREFIX,
  conversationSurfaceId,
  diffAllSurfaceId,
  diffSurfaceId,
  fileSurfaceId,
  fileNameFromPath,
  isPreviewSurface,
  terminalSurfaceId,
  type CenterSurface,
  type CenterSurfaceSlice,
  type CommitCenterSurface,
  type CommitFileCenterSurface,
  type CommittedCenterSurface,
  type ConflictCenterSurface,
  type ConversationCenterSurface,
  type DiffAllCenterSurface,
  type DiffCenterSurface,
  type FileCenterSurface,
  type BrowserCenterSurface,
  type TerminalCenterSurface,
} from './types.ts'

const EMPTY_SLICE: CenterSurfaceSlice = {
  open: [],
  activeId: null,
}

interface CenterSurfaceState {
  /** Per-workspace (cwd) open sets. */
  byCwd: Record<string, CenterSurfaceSlice>
  getSlice(cwd: string): CenterSurfaceSlice
  openConversation(input: {
    cwd: string
    sessionId: string
    title: string
    /** Activate the tab immediately (open gesture). Sync passes false. */
    activate?: boolean
  }): ConversationCenterSurface
  openFile(input: {
    cwd: string
    sessionId: string
    filePath: string
    title?: string
    preview?: boolean
    markdownPreview?: boolean
  }): FileCenterSurface
  setFileMarkdownPreview(cwd: string, surfaceId: string, markdownPreview: boolean): void
  openDiff(input: {
    cwd: string
    sessionId: string
    filePath: string
    staged: boolean
    title?: string
    preview?: boolean
  }): DiffCenterSurface
  openDiffAll(input: {
    cwd: string
    sessionId: string
    staged: boolean
    title?: string
    preview?: boolean
  }): DiffAllCenterSurface
  openCommit(input: {
    cwd: string
    sessionId: string
    hash: string
    title?: string
    preview?: boolean
  }): CommitCenterSurface
  openCommitFile(input: {
    cwd: string
    sessionId: string
    hash: string
    filePath: string
    title?: string
    preview?: boolean
  }): CommitFileCenterSurface
  openCommitted(input: {
    cwd: string
    sessionId: string
    baseRef: string
    filePath?: string
    title?: string
    preview?: boolean
  }): CommittedCenterSurface
  openConflict(input: {
    cwd: string
    sessionId: string
    filePath: string
    title?: string
    preview?: boolean
  }): ConflictCenterSurface
  openBrowser(input: {
    cwd: string
    title?: string
    resource?: string
    preview?: boolean
  }): BrowserCenterSurface
  openTerminal(input: { cwd: string; title: string }): TerminalCenterSurface
  /** Clear isPreview on a surface (double-click pin). */
  pin(cwd: string, surfaceId: string): void
  activate(cwd: string, surfaceId: string): void
  close(cwd: string, surfaceId: string): void
  clearCwd(cwd: string): void
  clearAll(): void
  /** Session ids whose center tab was closed, per workspace (persisted). */
  dismissedSessions: Record<string, string[]>
  dismissSession(cwd: string, sessionId: string): void
  undismissSession(cwd: string, sessionId: string): void
}

function readSlice(
  byCwd: Record<string, CenterSurfaceSlice>,
  cwd: string,
): CenterSurfaceSlice {
  return byCwd[cwd] ?? EMPTY_SLICE
}

function writeSlice(
  byCwd: Record<string, CenterSurfaceSlice>,
  cwd: string,
  slice: CenterSurfaceSlice,
): Record<string, CenterSurfaceSlice> {
  return { ...byCwd, [cwd]: slice }
}

function readDismissed(
  dismissed: Record<string, string[]>,
  cwd: string,
): readonly string[] {
  return dismissed[cwd] ?? []
}

/**
 * Open/replace semantics for previewable tabs:
 * - existing id → activate; pin if opening non-preview
 * - preview open → replace any other preview tab
 * - non-preview open → append pinned tab
 */
function openPreviewableSurface(
  current: CenterSurfaceSlice,
  next: FileCenterSurface | DiffCenterSurface | DiffAllCenterSurface | CommitCenterSurface | CommitFileCenterSurface | CommittedCenterSurface | ConflictCenterSurface | BrowserCenterSurface,
): CenterSurfaceSlice {
  const existingIndex = current.open.findIndex(surface => surface.id === next.id)
  if (existingIndex >= 0) {
    const existing = current.open[existingIndex]!
    const keepPinned =
      !next.isPreview
      || (existing.kind === next.kind && 'isPreview' in existing && existing.isPreview === false)
    const isPreview = keepPinned ? false : next.isPreview
    let changed = current.activeId !== next.id
    const open: CenterSurface[] = current.open.map((surface, surfaceIndex) => {
      if (surfaceIndex !== existingIndex) return surface
      if (surface.kind !== next.kind) return surface
      if (
        surface.title === next.title
        && surface.isPreview === isPreview
        && (surface.kind !== 'diff'
          || (next.kind === 'diff'
            && surface.staged === next.staged))
        && (surface.kind !== 'file'
          || (next.kind === 'file'
            && surface.filePath === next.filePath))
        && (surface.kind !== 'browser'
          || (next.kind === 'browser'
            && surface.resource === next.resource))
      ) {
        return surface
      }
      changed = true
      if (surface.kind === 'diff' && next.kind === 'diff') {
        return { ...surface, title: next.title, staged: next.staged, isPreview } as DiffCenterSurface
      }
      if (surface.kind === 'diff-all' && next.kind === 'diff-all') {
        return { ...surface, title: next.title, staged: next.staged, isPreview } as DiffAllCenterSurface
      }
      if (surface.kind === 'file' && next.kind === 'file') {
        return { ...surface, title: next.title, isPreview, markdownPreview: next.markdownPreview ?? surface.markdownPreview } as FileCenterSurface
      }
      if (surface.kind === 'browser' && next.kind === 'browser') {
        return { ...surface, title: next.title, resource: next.resource, isPreview } as BrowserCenterSurface
      }
      if (surface.kind === 'commit' && next.kind === 'commit') {
        return { ...surface, title: next.title, isPreview } as CommitCenterSurface
      }
      if (surface.kind === 'commit-file' && next.kind === 'commit-file') {
        return { ...surface, title: next.title, isPreview } as CommitFileCenterSurface
      }
      if (surface.kind === 'committed' && next.kind === 'committed') {
        return { ...surface, title: next.title, isPreview } as CommittedCenterSurface
      }
      return surface
    })
    if (!changed) {
      return current.activeId === next.id ? current : { open: current.open, activeId: next.id }
    }
    return { open, activeId: next.id }
  }

  if (next.isPreview) {
    const withoutOtherPreview = current.open.filter(surface => !isPreviewSurface(surface))
    return {
      open: [...withoutOtherPreview, next],
      activeId: next.id,
    }
  }

  return {
    open: [...current.open, next],
    activeId: next.id,
  }
}

export const useCenterSurfaceStore = create<CenterSurfaceState>((set, get) => ({
  byCwd: {},
  dismissedSessions: {},

  getSlice: cwd => readSlice(get().byCwd, cwd),

  openConversation: input => {
    const id = conversationSurfaceId(input.sessionId)
    const shouldActivate = input.activate ?? true
    const nextSurface: ConversationCenterSurface = {
      id,
      kind: 'conversation',
      sessionId: input.sessionId,
      cwd: input.cwd,
      title: input.title,
      closable: true,
      isPreview: false,
    }
    set(state => {
      const slice = readSlice(state.byCwd, input.cwd)
      const existingIndex = slice.open.findIndex(surface => surface.id === id)
      if (existingIndex >= 0) {
        if (slice.activeId === id || !shouldActivate) return state
        return { byCwd: writeSlice(state.byCwd, input.cwd, { open: slice.open, activeId: id }) }
      }
      return {
        byCwd: writeSlice(state.byCwd, input.cwd, {
          open: [...slice.open, nextSurface],
          activeId: shouldActivate ? id : slice.activeId,
        }),
      }
    })
    return nextSurface
  },

  openFile: input => {
    const id = fileSurfaceId(input.filePath)
    const isPreview = input.preview ?? true
    const nextSurface: FileCenterSurface = {
      id,
      kind: 'file',
      sessionId: input.sessionId,
      cwd: input.cwd,
      filePath: input.filePath,
      title: input.title?.trim() || fileNameFromPath(input.filePath),
      closable: true,
      isPreview,
      ...(input.markdownPreview === undefined ? {} : { markdownPreview: input.markdownPreview }),
    }
    set(state => {
      const slice = readSlice(state.byCwd, input.cwd)
      const next = openPreviewableSurface(slice, nextSurface)
      if (next === slice) return state
      return { byCwd: writeSlice(state.byCwd, input.cwd, next) }
    })
    return nextSurface
  },

  openDiff: input => {
    const id = diffSurfaceId(input.filePath, input.staged)
    const isPreview = input.preview ?? true
    const nextSurface: DiffCenterSurface = {
      id,
      kind: 'diff',
      sessionId: input.sessionId,
      cwd: input.cwd,
      filePath: input.filePath,
      staged: input.staged,
      title: input.title?.trim() || fileNameFromPath(input.filePath),
      closable: true,
      isPreview,
    }
    set(state => {
      const slice = readSlice(state.byCwd, input.cwd)
      const next = openPreviewableSurface(slice, nextSurface)
      if (next === slice) return state
      return { byCwd: writeSlice(state.byCwd, input.cwd, next) }
    })
    return nextSurface
  },

  openCommit: input => {
    const id = commitSurfaceId(input.hash)
    const isPreview = input.preview ?? true
    const nextSurface: CommitCenterSurface = {
      id,
      kind: 'commit',
      sessionId: input.sessionId,
      cwd: input.cwd,
      hash: input.hash,
      title: input.title?.trim() || input.hash.slice(0, 7),
      closable: true,
      isPreview,
    }
    set(state => {
      const slice = readSlice(state.byCwd, input.cwd)
      const next = openPreviewableSurface(slice, nextSurface)
      if (next === slice) return state
      return { byCwd: writeSlice(state.byCwd, input.cwd, next) }
    })
    return nextSurface
  },

  openCommitFile: input => {
    const id = commitFileSurfaceId(input.hash, input.filePath)
    const isPreview = input.preview ?? true
    const nextSurface: CommitFileCenterSurface = {
      id,
      kind: 'commit-file',
      sessionId: input.sessionId,
      cwd: input.cwd,
      hash: input.hash,
      filePath: input.filePath,
      title: input.title?.trim() || fileNameFromPath(input.filePath),
      closable: true,
      isPreview,
    }
    set(state => {
      const slice = readSlice(state.byCwd, input.cwd)
      const next = openPreviewableSurface(slice, nextSurface)
      if (next === slice) return state
      return { byCwd: writeSlice(state.byCwd, input.cwd, next) }
    })
    return nextSurface
  },

  openCommitted: input => {
    const id = committedSurfaceId(input.baseRef, input.filePath)
    const isPreview = input.preview ?? true
    const nextSurface: CommittedCenterSurface = {
      id,
      kind: 'committed',
      sessionId: input.sessionId,
      cwd: input.cwd,
      baseRef: input.baseRef,
      ...(input.filePath === undefined ? {} : { filePath: input.filePath }),
      title: input.title?.trim() || (input.filePath === undefined ? 'Committed changes' : fileNameFromPath(input.filePath)),
      closable: true,
      isPreview,
    }
    set(state => {
      const slice = readSlice(state.byCwd, input.cwd)
      const next = openPreviewableSurface(slice, nextSurface)
      if (next === slice) return state
      return { byCwd: writeSlice(state.byCwd, input.cwd, next) }
    })
    return nextSurface
  },

  openConflict: input => {
    const id = conflictSurfaceId(input.filePath)
    const isPreview = input.preview ?? true
    const nextSurface: ConflictCenterSurface = {
      id,
      kind: 'conflict',
      sessionId: input.sessionId,
      cwd: input.cwd,
      filePath: input.filePath,
      title: input.title?.trim() || fileNameFromPath(input.filePath),
      closable: true,
      isPreview,
    }
    set(state => {
      const slice = readSlice(state.byCwd, input.cwd)
      const next = openPreviewableSurface(slice, nextSurface)
      if (next === slice) return state
      return { byCwd: writeSlice(state.byCwd, input.cwd, next) }
    })
    return nextSurface
  },

  openDiffAll: input => {
    const id = diffAllSurfaceId(input.staged)
    const isPreview = input.preview ?? true
    const nextSurface: DiffAllCenterSurface = {
      id,
      kind: 'diff-all',
      sessionId: input.sessionId,
      cwd: input.cwd,
      staged: input.staged,
      title: input.title?.trim() || (input.staged ? 'Staged changes' : 'Changes'),
      closable: true,
      isPreview,
    }
    set(state => {
      const slice = readSlice(state.byCwd, input.cwd)
      const next = openPreviewableSurface(slice, nextSurface)
      if (next === slice) return state
      return { byCwd: writeSlice(state.byCwd, input.cwd, next) }
    })
    return nextSurface
  },

  openBrowser: input => {
    const id = browserSurfaceId(input.resource)
    const isPreview = input.preview ?? true
    const nextSurface: BrowserCenterSurface = {
      id,
      kind: 'browser',
      cwd: input.cwd,
      title: input.title?.trim() || 'Browser',
      ...(input.resource === undefined ? {} : { resource: input.resource }),
      closable: true,
      isPreview,
    }
    set(state => {
      const slice = readSlice(state.byCwd, input.cwd)
      const next = openPreviewableSurface(slice, nextSurface)
      if (next === slice) return state
      return { byCwd: writeSlice(state.byCwd, input.cwd, next) }
    })
    return nextSurface
  },

  openTerminal: input => {
    const id = terminalSurfaceId()
    const nextSurface: TerminalCenterSurface = {
      id,
      kind: 'terminal',
      cwd: input.cwd,
      title: input.title,
      closable: true,
      isPreview: false,
    }
    set(state => {
      const slice = readSlice(state.byCwd, input.cwd)
      const existing = slice.open.some(surface => surface.id === id)
      if (existing && slice.activeId === id) return state
      const open = existing ? slice.open : [...slice.open, nextSurface]
      return { byCwd: writeSlice(state.byCwd, input.cwd, { open, activeId: id }) }
    })
    return nextSurface
  },

  setFileMarkdownPreview: (cwd, surfaceId, markdownPreview) => {
    set(state => {
      const slice = readSlice(state.byCwd, cwd)
      let changed = false
      const open = slice.open.map(surface => {
        if (surface.id !== surfaceId || surface.kind !== 'file') return surface
        if (surface.markdownPreview === markdownPreview) return surface
        changed = true
        return { ...surface, markdownPreview }
      })
      if (!changed) return state
      return { byCwd: writeSlice(state.byCwd, cwd, { open, activeId: slice.activeId }) }
    })
  },

  pin: (cwd, surfaceId) => {
    set(state => {
      const slice = readSlice(state.byCwd, cwd)
      let changed = false
      const open = slice.open.map(surface => {
        if (surface.id !== surfaceId) return surface
        if (surface.kind === 'file' || surface.kind === 'diff' || surface.kind === 'commit' || surface.kind === 'commit-file' || surface.kind === 'committed' || surface.kind === 'conflict' || surface.kind === 'browser') {
          if (surface.isPreview) {
            changed = true
            return { ...surface, isPreview: false }
          }
        }
        return surface
      })
      if (!changed) return state
      return { byCwd: writeSlice(state.byCwd, cwd, { open, activeId: slice.activeId }) }
    })
  },

  activate: (cwd, surfaceId) => {
    set(state => {
      const slice = readSlice(state.byCwd, cwd)
      if (slice.activeId === surfaceId) return state
      // Conversation tabs are rendered from the sessions list, not from the
      // open set — activating one must still work (it hides the surface
      // body and reveals the conversation).
      const isConversation = surfaceId.startsWith(CONVERSATION_SURFACE_PREFIX)
      if (!isConversation && !slice.open.some(surface => surface.id === surfaceId)) {
        return state
      }
      return { byCwd: writeSlice(state.byCwd, cwd, { open: slice.open, activeId: surfaceId }) }
    })
  },

  close: (cwd, surfaceId) => {
    set(state => {
      const slice = readSlice(state.byCwd, cwd)
      const open = slice.open.filter(surface => surface.id !== surfaceId)
      if (open.length === slice.open.length) return state
      let activeId = slice.activeId
      if (activeId === surfaceId) {
        activeId = open.at(-1)?.id ?? null
      }
      return { byCwd: writeSlice(state.byCwd, cwd, { open, activeId }) }
    })
  },

  clearCwd: cwd => {
    set(state => {
      if (state.byCwd[cwd] === undefined) return state
      const next = { ...state.byCwd }
      delete next[cwd]
      return { byCwd: next }
    })
  },

  clearAll: () => set({ byCwd: {}, dismissedSessions: {} }),

  dismissSession: (cwd, sessionId) => {
    set(state => {
      const dismissed = readDismissed(state.dismissedSessions, cwd)
      if (dismissed.includes(sessionId)) return state
      return { dismissedSessions: { ...state.dismissedSessions, [cwd]: [...dismissed, sessionId] } }
    })
  },

  undismissSession: (cwd, sessionId) => {
    set(state => {
      const dismissed = readDismissed(state.dismissedSessions, cwd)
      if (!dismissed.includes(sessionId)) return state
      const next = dismissed.filter(id => id !== sessionId)
      const rest = { ...state.dismissedSessions }
      if (next.length > 0) rest[cwd] = next
      else delete rest[cwd]
      return { dismissedSessions: rest }
    })
  },
}))

/* ---------- localStorage persistence (thin layer, store stays pure) ---------- */

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
        state.openTerminal({ cwd, title: surface.title })
      }
    }
    const activeId = open.some(surface => surface.id === entry.activeId)
      ? entry.activeId
      : open.at(-1)?.id ?? null
    if (activeId !== null) state.activate(cwd, activeId)
  }
}
