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
import { reorderById, type TabDropSide } from '../tab-drag.ts'
import {
  browserSurfaceId,
  commitFileSurfaceId,
  commitSurfaceId,
  committedSurfaceId,
  conflictSurfaceId,
  conversationSurfaceId,
  diffAllSurfaceId,
  diffSurfaceId,
  fileSurfaceId,
  fileNameFromPath,
  isPreviewSurface,
  maxTerminalInstance,
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
  /** Record a workspace queue even when it intentionally contains no tabs. */
  ensureCwd(cwd: string): void
  openConversation(input: {
    cwd: string
    sessionId: string
    title: string
    /** Activate the tab immediately (open gesture). Sync passes false. */
    activate?: boolean
  }): ConversationCenterSurface
  openFile(input: {
    cwd: string
    filePath: string
    title?: string
    preview?: boolean
    markdownPreview?: boolean
  }): FileCenterSurface
  setFileMarkdownPreview(cwd: string, surfaceId: string, markdownPreview: boolean): void
  openDiff(input: {
    cwd: string
    filePath: string
    staged: boolean
    title?: string
    preview?: boolean
  }): DiffCenterSurface
  openDiffAll(input: {
    cwd: string
    staged: boolean
    title?: string
    preview?: boolean
  }): DiffAllCenterSurface
  openCommit(input: {
    cwd: string
    hash: string
    title?: string
    preview?: boolean
  }): CommitCenterSurface
  openCommitFile(input: {
    cwd: string
    hash: string
    filePath: string
    title?: string
    preview?: boolean
  }): CommitFileCenterSurface
  openCommitted(input: {
    cwd: string
    baseRef: string
    filePath?: string
    title?: string
    preview?: boolean
  }): CommittedCenterSurface
  openConflict(input: {
    cwd: string
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
  openTerminal(input: { cwd: string; title: string; id?: string }): TerminalCenterSurface
  /** Update renderer-owned metadata such as a terminal's shell title. */
  updateSurfaceTitle(cwd: string, surfaceId: string, title: string): void
  /** Clear isPreview on a surface (double-click pin). */
  pin(cwd: string, surfaceId: string): void
  activate(cwd: string, surfaceId: string): void
  /** Clear the workspace's active surface — no tab highlighted, conversation stage shows. */
  deactivate(cwd: string): void
  /** Reorder open surfaces relative to a target surface (drag sort). */
  reorderSurfaces(cwd: string, sourceId: string, targetId: string | null | undefined, side?: TabDropSide): void
  /** Reorder one open surface within its workspace queue (drag sort). */
  moveSurface(cwd: string, surfaceId: string, toIndex: number): void
  close(cwd: string, surfaceId: string): void
  clearCwd(cwd: string): void
  clearAll(): void
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

  getSlice: cwd => readSlice(get().byCwd, cwd),

  ensureCwd: cwd => {
    set(state => state.byCwd[cwd] === undefined
      ? { byCwd: writeSlice(state.byCwd, cwd, EMPTY_SLICE) }
      : state)
  },

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
    // Every terminal tab is its own instance: the id (`terminal:<n>`) is
    // unique per open set and doubles as the pty's `tab` identity, so
    // opening N terminal tabs spins up N independent shells. An explicit
    // `id` (restore path) re-opens that exact instance; otherwise take the
    // next free number.
    const id = input.id ?? terminalSurfaceId(
      maxTerminalInstance(readSlice(get().byCwd, input.cwd).open) + 1,
    )
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

  updateSurfaceTitle: (cwd, surfaceId, title) => {
    const nextTitle = title.slice(0, 240)
    set(state => {
      const slice = readSlice(state.byCwd, cwd)
      let changed = false
      const open = slice.open.map(surface => {
        if (surface.id !== surfaceId || surface.title === nextTitle) return surface
        changed = true
        return { ...surface, title: nextTitle }
      })
      if (!changed) return state
      return { byCwd: writeSlice(state.byCwd, cwd, { open, activeId: slice.activeId }) }
    })
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
      if (!slice.open.some(surface => surface.id === surfaceId)) return state
      return { byCwd: writeSlice(state.byCwd, cwd, { open: slice.open, activeId: surfaceId }) }
    })
  },

  deactivate: (cwd) => {
    set(state => {
      const slice = readSlice(state.byCwd, cwd)
      if (slice.activeId === null) return state
      return { byCwd: writeSlice(state.byCwd, cwd, { open: slice.open, activeId: null }) }
    })
  },

  reorderSurfaces: (cwd, sourceId, targetId, side = 'after') => {
    set(state => {
      const slice = readSlice(state.byCwd, cwd)
      const open = reorderById(slice.open, sourceId, targetId, side)
      return { byCwd: writeSlice(state.byCwd, cwd, { open, activeId: slice.activeId }) }
    })
  },

  moveSurface: (cwd, surfaceId, toIndex) => {
    set(state => {
      const slice = readSlice(state.byCwd, cwd)
      if (slice.open.length <= 1) return state
      const from = slice.open.findIndex(surface => surface.id === surfaceId)
      if (from === -1) return state
      const clamped = Math.max(0, Math.min(slice.open.length - 1, toIndex))
      if (clamped === from) return state
      const open = [...slice.open]
      const [moved] = open.splice(from, 1)
      open.splice(clamped, 0, moved!)
      return { byCwd: writeSlice(state.byCwd, cwd, { open, activeId: slice.activeId }) }
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

  clearAll: () => set({ byCwd: {} }),
}))


/* ---------- localStorage persistence (extracted module) ---------- */

export {
  persistCenterSurfaces,
  restoreCenterSurfaces,
  type PersistedCenterSurfaces,
} from './center-surface-persistence.ts'
