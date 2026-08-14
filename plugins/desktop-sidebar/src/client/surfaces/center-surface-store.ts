/**
 * Center surface store (ported from the reference project's
 * `surfaces/center-surface-store.ts`).
 *
 * The center open-set identity owner: which tabs are open in the middle
 * area and which one is active. Pure synchronous identity writes — opening
 * a surface never fetches or mounts React (callers schedule those after).
 *
 * Preview/pin semantics (the single implementation point is
 * `openPreviewableSurface`):
 * - single click (`preview: true`, default) replaces the current preview tab
 *   — at most ONE preview tab exists at a time;
 * - double click / explicit open (`preview: false`) pins the tab;
 * - conversations and terminals are always pinned (`isPreview: false`).
 *
 * Persistence: the store itself is pure memory. A thin subscriber layer
 * (see `persistCenterSurfaces`) mirrors the open set to localStorage and
 * rebuilds it on startup — deliberately NOT zustand `persist` middleware so
 * the identity store stays pure.
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
  slice: CenterSurfaceSlice
  getSlice(): CenterSurfaceSlice
  openConversation(input: {
    sessionId: string
    cwd: string
    title: string
    /** Activate the tab immediately (open gesture). Sync passes false. */
    activate?: boolean
  }): ConversationCenterSurface
  openFile(input: {
    sessionId: string
    cwd: string
    filePath: string
    title?: string
    preview?: boolean
  }): FileCenterSurface
  openDiff(input: {
    sessionId: string
    cwd: string
    filePath: string
    staged: boolean
    title?: string
    preview?: boolean
  }): DiffCenterSurface
  openBrowser(input: { title?: string; resource?: string; preview?: boolean }): BrowserCenterSurface
  openTerminal(input: { title: string }): TerminalCenterSurface
  /** Clear isPreview on a surface (double-click pin). */
  pin(surfaceId: string): void
  activate(surfaceId: string): void
  close(surfaceId: string): void
  clearAll(): void
  /** Session ids whose center tab was closed by the user (persisted). */
  dismissedSessions: readonly string[]
  dismissSession(sessionId: string): void
  undismissSession(sessionId: string): void
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
  slice: EMPTY_SLICE,
  dismissedSessions: [],

  getSlice: () => get().slice,

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
      const existingIndex = state.slice.open.findIndex(surface => surface.id === id)
      if (existingIndex >= 0) {
        if (state.slice.activeId === id || !shouldActivate) return state
        return { slice: { open: state.slice.open, activeId: id } }
      }
      return {
        slice: {
          open: [...state.slice.open, nextSurface],
          activeId: shouldActivate ? id : state.slice.activeId,
        },
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
      const next = openPreviewableSurface(state.slice, nextSurface)
      if (next === state.slice) return state
      return { slice: next }
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
      const next = openPreviewableSurface(state.slice, nextSurface)
      if (next === state.slice) return state
      return { slice: next }
    })
    return nextSurface
  },

  openBrowser: input => {
    const id = browserSurfaceId(input.resource)
    const isPreview = input.preview ?? true
    const nextSurface: BrowserCenterSurface = {
      id,
      kind: 'browser',
      title: input.title?.trim() || 'Browser',
      ...(input.resource === undefined ? {} : { resource: input.resource }),
      closable: true,
      isPreview,
    }
    set(state => {
      const next = openPreviewableSurface(state.slice, nextSurface)
      if (next === state.slice) return state
      return { slice: next }
    })
    return nextSurface
  },

  openTerminal: input => {
    const id = terminalSurfaceId()
    const nextSurface: TerminalCenterSurface = {
      id,
      kind: 'terminal',
      title: input.title,
      closable: true,
      isPreview: false,
    }
    set(state => {
      const existing = state.slice.open.some(surface => surface.id === id)
      if (existing && state.slice.activeId === id) return state
      const open = existing ? state.slice.open : [...state.slice.open, nextSurface]
      return { slice: { open, activeId: id } }
    })
    return nextSurface
  },

  pin: surfaceId => {
    set(state => {
      let changed = false
      const open = state.slice.open.map(surface => {
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
      return { slice: { open, activeId: state.slice.activeId } }
    })
  },

  activate: surfaceId => {
    set(state => {
      if (state.slice.activeId === surfaceId) return state
      // Conversation tabs are rendered from the sessions list, not from the
      // open set — activating one must still work (it hides the surface
      // body and reveals the conversation).
      const isConversation = surfaceId.startsWith('conversation:')
      if (!isConversation && !state.slice.open.some(surface => surface.id === surfaceId)) {
        return state
      }
      return { slice: { open: state.slice.open, activeId: surfaceId } }
    })
  },

  close: surfaceId => {
    set(state => {
      const open = state.slice.open.filter(surface => surface.id !== surfaceId)
      if (open.length === state.slice.open.length) return state
      let activeId = state.slice.activeId
      if (activeId === surfaceId) {
        activeId = open.at(-1)?.id ?? null
      }
      return { slice: { open, activeId } }
    })
  },

  clearAll: () => set({ slice: EMPTY_SLICE }),

  dismissSession: sessionId => {
    set(state => {
      if (state.dismissedSessions.includes(sessionId)) return state
      return { dismissedSessions: [...state.dismissedSessions, sessionId] }
    })
  },

  undismissSession: sessionId => {
    set(state => {
      if (!state.dismissedSessions.includes(sessionId)) return state
      return { dismissedSessions: state.dismissedSessions.filter(id => id !== sessionId) }
    })
  },
}))

/* ---------- localStorage persistence (thin layer, store stays pure) ---------- */

const CENTER_SURFACES_STORAGE_KEY = 'oh-dsh-desktop.center-surfaces'

export interface PersistedCenterSurfaces {
  /** v2: diff surfaces carry the corrected staged flag (v1 predates the
   *  porcelain v2 staged fix and can resurrect stale NO-DIFF tabs). */
  version: 2
  open: ReadonlyArray<CenterSurface>
  activeId: string | null
  /** Session tabs the user closed; sync skips them until reopened. */
  dismissedSessions?: readonly string[]
}

/** Mirror the open set to localStorage on every change. */
export function persistCenterSurfaces(): () => void {
  return useCenterSurfaceStore.subscribe(state => {
    try {
      const payload: PersistedCenterSurfaces = {
        version: 2,
        open: state.slice.open,
        activeId: state.slice.activeId,
        ...(state.dismissedSessions.length > 0 ? { dismissedSessions: state.dismissedSessions } : {}),
      }
      window.localStorage.setItem(CENTER_SURFACES_STORAGE_KEY, JSON.stringify(payload))
    } catch {
      // Storage may be unavailable (private mode); persistence is best-effort.
    }
  })
}

/** Rebuild the open set from localStorage (startup). Pinned tabs restore as-is. */
export function restoreCenterSurfaces(): void {
  let payload: PersistedCenterSurfaces | null = null
  try {
    const raw = window.localStorage.getItem(CENTER_SURFACES_STORAGE_KEY)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<PersistedCenterSurfaces>
      if (parsed.version === 2 && Array.isArray(parsed.open)) {
        payload = {
          version: 2,
          open: parsed.open,
          activeId: parsed.activeId ?? null,
          ...(Array.isArray(parsed.dismissedSessions)
            ? { dismissedSessions: parsed.dismissedSessions }
            : {}),
        }
      }
    }
  } catch {
    return
  }
  if (payload === null) return
  const state = useCenterSurfaceStore.getState()
  const open = payload.open.filter(
    (surface): surface is CenterSurface =>
      surface !== null && typeof surface === 'object' && typeof surface.id === 'string'
      && typeof surface.kind === 'string'
      && typeof surface.title === 'string'
      && typeof surface.closable === 'boolean'
      && typeof surface.isPreview === 'boolean',
  )
  const activeId = open.some(surface => surface.id === payload!.activeId)
    ? payload!.activeId
    : open.at(-1)?.id ?? null
  const dismissedSessions = Array.isArray(payload.dismissedSessions)
    ? payload.dismissedSessions.filter((id): id is string => typeof id === 'string')
    : []
  state.clearAll()
  if (dismissedSessions.length > 0) {
    useCenterSurfaceStore.setState({ dismissedSessions })
  }
  // Re-insert through the store so ids/order stay canonical.
  for (const surface of open) {
    if (surface.kind === 'conversation') {
      state.openConversation({ sessionId: surface.sessionId, cwd: surface.cwd, title: surface.title, activate: false })
    } else if (surface.kind === 'file') {
      state.openFile({ sessionId: surface.sessionId, cwd: surface.cwd, filePath: surface.filePath, title: surface.title, preview: false })
    } else if (surface.kind === 'diff') {
      state.openDiff({ sessionId: surface.sessionId, cwd: surface.cwd, filePath: surface.filePath, staged: surface.staged, title: surface.title, preview: false })
    } else if (surface.kind === 'browser') {
      state.openBrowser({
        title: surface.title,
        ...(surface.resource === undefined ? {} : { resource: surface.resource }),
        preview: false,
      })
    } else if (surface.kind === 'terminal') {
      state.openTerminal({ title: surface.title })
    }
  }
  if (activeId !== null) state.activate(activeId)
}
