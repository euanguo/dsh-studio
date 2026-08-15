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
  conversationSurfaceId,
  diffSurfaceId,
  fileSurfaceId,
  fileNameFromPath,
  isPreviewSurface,
  terminalSurfaceId,
  type CenterSurface,
  type CenterSurfaceSlice,
  type ConversationCenterSurface,
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
  }): FileCenterSurface
  openDiff(input: {
    cwd: string
    sessionId: string
    filePath: string
    staged: boolean
    title?: string
    preview?: boolean
  }): DiffCenterSurface
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
  next: FileCenterSurface | DiffCenterSurface | BrowserCenterSurface,
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
      if (surface.kind === 'file' && next.kind === 'file') {
        return { ...surface, title: next.title, isPreview } as FileCenterSurface
      }
      if (surface.kind === 'browser' && next.kind === 'browser') {
        return { ...surface, title: next.title, resource: next.resource, isPreview } as BrowserCenterSurface
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

  pin: (cwd, surfaceId) => {
    set(state => {
      const slice = readSlice(state.byCwd, cwd)
      let changed = false
      const open = slice.open.map(surface => {
        if (surface.id !== surfaceId) return surface
        if (surface.kind === 'file' || surface.kind === 'diff' || surface.kind === 'browser') {
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
      const isConversation = surfaceId.startsWith('conversation:')
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

/** Mirror every workspace's open set to localStorage on each change. */
export function persistCenterSurfaces(): () => void {
  return useCenterSurfaceStore.subscribe(state => {
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
  })
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
  } catch {
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
        state.openFile({ cwd, sessionId: surface.sessionId, filePath: surface.filePath, title: surface.title, preview: false })
      } else if (surface.kind === 'diff') {
        state.openDiff({ cwd, sessionId: surface.sessionId, filePath: surface.filePath, staged: surface.staged, title: surface.title, preview: false })
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
