/**
 * Sidebar UI chrome store. State is memory-only in zustand; the plugin
 * lifecycle hydrates and persists the complete `sidebar_chrome` DTO through
 * the shared host storage client.
 */
import { create } from 'zustand'
import {
  UI_CHROME_TABLES,
  defaultSidebarChromeSlice,
  defaultSidebarChromeState,
  sanitizeSidebarChrome,
  type GitListMode,
  type SidebarChromeSlice,
  type SidebarChromeState,
} from '@dsh-studio/shared/ui-chrome-tables'
import {
  persistVia,
  persistedSliceBackend,
  type PersistedSliceDefinition,
} from '@dsh-studio/shared/store-persistence'
import { createUiChromeStorage } from '@dsh-studio/shared/ui-chrome-storage'

export type { GitListMode, SidebarChromeSlice } from '@dsh-studio/shared/ui-chrome-tables'
export type ExplorerChromeSlice = SidebarChromeSlice['explorer']
export type SourceControlChromeSlice = SidebarChromeSlice['sourceControl']

interface SidebarChromeActions {
  getSlice: (scopeKey: string) => SidebarChromeSlice
  setExplorerSelectedPath: (scopeKey: string, path: string | null) => void
  toggleExplorerDirectory: (scopeKey: string, path: string) => void
  setSourceControlSelectedPath: (scopeKey: string, path: string | null) => void
  setSourceControlCommitMessage: (scopeKey: string, message: string) => void
  toggleSourceControlSection: (scopeKey: string, id: string) => void
  toggleSourceControlDirectory: (scopeKey: string, key: string) => void
  setGitListMode: (scopeKey: string, mode: GitListMode) => void
  setDiffViewLayout: (scopeKey: string, layout: 'unified' | 'split') => void
  setDiffViewWordWrap: (scopeKey: string, wordWrap: boolean) => void
  clearScope: (scopeKey: string) => void
}

type SidebarChromeStore = SidebarChromeState & SidebarChromeActions

/**
 * One stable default slice. Selectors hand this to useSyncExternalStore for
 * unknown scopes, so the reference must stay identical across evaluations —
 * a fresh object per call makes React loop to "maximum update depth" and
 * unmount the rail. Readonly DTO fields guard the shared object from
 * accidental mutation.
 */
const DEFAULT_SLICE: SidebarChromeSlice = defaultSidebarChromeSlice()

function readSlice(state: Pick<SidebarChromeState, 'byScope'>, scopeKey: string): SidebarChromeSlice {
  return state.byScope[scopeKey] ?? DEFAULT_SLICE
}

function writeSlice(
  state: Pick<SidebarChromeState, 'byScope'>,
  scopeKey: string,
  slice: SidebarChromeSlice,
): SidebarChromeState['byScope'] {
  return { ...state.byScope, [scopeKey]: slice }
}

function toggleInList(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter(item => item !== value) : [...list, value]
}

export const useSidebarChromeStore = create<SidebarChromeStore>()((set, get) => ({
  ...defaultSidebarChromeState(),

  getSlice: scopeKey => readSlice(get(), scopeKey),

  setExplorerSelectedPath: (scopeKey, path) => {
    set(state => {
      const slice = readSlice(state, scopeKey)
      if (slice.explorer.selectedPath === path) return state
      return {
        byScope: writeSlice(state, scopeKey, {
          ...slice,
          explorer: { ...slice.explorer, selectedPath: path },
        }),
      }
    })
  },

  toggleExplorerDirectory: (scopeKey, path) => {
    set(state => {
      const slice = readSlice(state, scopeKey)
      return {
        byScope: writeSlice(state, scopeKey, {
          ...slice,
          explorer: {
            ...slice.explorer,
            expandedPaths: toggleInList(slice.explorer.expandedPaths, path),
          },
        }),
      }
    })
  },

  setSourceControlSelectedPath: (scopeKey, path) => {
    set(state => {
      const slice = readSlice(state, scopeKey)
      if (slice.sourceControl.selectedPath === path) return state
      return {
        byScope: writeSlice(state, scopeKey, {
          ...slice,
          sourceControl: { ...slice.sourceControl, selectedPath: path },
        }),
      }
    })
  },

  setSourceControlCommitMessage: (scopeKey, message) => {
    set(state => {
      const slice = readSlice(state, scopeKey)
      if (slice.sourceControl.commitMessage === message) return state
      return {
        byScope: writeSlice(state, scopeKey, {
          ...slice,
          sourceControl: { ...slice.sourceControl, commitMessage: message },
        }),
      }
    })
  },

  toggleSourceControlSection: (scopeKey, id) => {
    set(state => {
      const slice = readSlice(state, scopeKey)
      return {
        byScope: writeSlice(state, scopeKey, {
          ...slice,
          sourceControl: {
            ...slice.sourceControl,
            collapsedSections: toggleInList(slice.sourceControl.collapsedSections, id),
          },
        }),
      }
    })
  },

  toggleSourceControlDirectory: (scopeKey, key) => {
    set(state => {
      const slice = readSlice(state, scopeKey)
      return {
        byScope: writeSlice(state, scopeKey, {
          ...slice,
          sourceControl: {
            ...slice.sourceControl,
            collapsedDirectories: toggleInList(slice.sourceControl.collapsedDirectories, key),
          },
        }),
      }
    })
  },

  setGitListMode: (scopeKey, mode) => {
    set(state => {
      const slice = readSlice(state, scopeKey)
      if (slice.gitListMode === mode) return state
      return {
        byScope: writeSlice(state, scopeKey, { ...slice, gitListMode: mode }),
      }
    })
  },

  setDiffViewLayout: (scopeKey, layout) => {
    set(state => {
      const slice = readSlice(state, scopeKey)
      if (slice.diffView.layout === layout) return state
      return {
        byScope: writeSlice(state, scopeKey, {
          ...slice,
          diffView: { ...slice.diffView, layout },
        }),
      }
    })
  },

  setDiffViewWordWrap: (scopeKey, wordWrap) => {
    set(state => {
      const slice = readSlice(state, scopeKey)
      if (slice.diffView.wordWrap === wordWrap) return state
      return {
        byScope: writeSlice(state, scopeKey, {
          ...slice,
          diffView: { ...slice.diffView, wordWrap },
        }),
      }
    })
  },

  clearScope: scopeKey => {
    set(state => {
      if (state.byScope[scopeKey] === undefined) return state
      const next = { ...state.byScope }
      delete next[scopeKey]
      return { byScope: next }
    })
  },
}))

// -- persistence (template C, field-level merge) --------------------------

function mergeStringLists(stored: readonly string[], current: readonly string[]): string[] {
  // Union: persisted items already expanded/collapsed stay, early toggles are
  // added. Dedupe preserves stored ordering then appends new early additions.
  const seen = new Set<string>(stored)
  const merged = [...stored]
  for (const item of current) {
    if (!seen.has(item)) {
      seen.add(item)
      merged.push(item)
    }
  }
  return merged
}

/**
 * Field-level merge of a stored chrome document with concurrent early UI
 * changes. Scalar fields prefer the stored value and only accept the current
 * value when it differs from the default sentinel (i.e. the user changed it
 * before hydration); list fields (`expandedPaths`, collapsed sets) UNION the
 * two sources so an early toggle never discards a persisted path. This is the
 * F11 fix: the old whole-scope `{ ...value.byScope, ...current }` replaced an
 * entire persisted scope with the in-memory projection and lost early work.
 */
export function mergeSidebarChrome(
  stored: SidebarChromeState,
  current: SidebarChromeState,
): SidebarChromeState {
  const byScope: Record<string, SidebarChromeSlice> = {}
  const scopes = new Set([...Object.keys(stored.byScope), ...Object.keys(current.byScope)])
  for (const scope of scopes) {
    const storedSlice = stored.byScope[scope]
    const currentSlice = current.byScope[scope]
    if (storedSlice === undefined) {
      if (currentSlice !== undefined) byScope[scope] = currentSlice
      continue
    }
    if (currentSlice === undefined) { byScope[scope] = storedSlice; continue }
    const defaults = defaultSidebarChromeSlice()
    byScope[scope] = {
      explorer: {
        expandedPaths: mergeStringLists(
          storedSlice.explorer.expandedPaths,
          currentSlice.explorer.expandedPaths,
        ),
        selectedPath: currentSlice.explorer.selectedPath ?? storedSlice.explorer.selectedPath,
      },
      sourceControl: {
        collapsedSections: mergeStringLists(
          storedSlice.sourceControl.collapsedSections,
          currentSlice.sourceControl.collapsedSections,
        ),
        collapsedDirectories: mergeStringLists(
          storedSlice.sourceControl.collapsedDirectories,
          currentSlice.sourceControl.collapsedDirectories,
        ),
        selectedPath: currentSlice.sourceControl.selectedPath ?? storedSlice.sourceControl.selectedPath,
        commitMessage: currentSlice.sourceControl.commitMessage || storedSlice.sourceControl.commitMessage,
      },
      gitListMode: currentSlice.gitListMode === defaults.gitListMode
        ? storedSlice.gitListMode
        : currentSlice.gitListMode,
      diffView: {
        layout: currentSlice.diffView.layout === defaults.diffView.layout
          ? storedSlice.diffView.layout
          : currentSlice.diffView.layout,
        wordWrap: currentSlice.diffView.wordWrap === defaults.diffView.wordWrap
          ? storedSlice.diffView.wordWrap
          : currentSlice.diffView.wordWrap,
      },
    }
  }
  return { byScope }
}

function chromeSnapshot(): SidebarChromeState {
  return { byScope: structuredClone(useSidebarChromeStore.getState().byScope) }
}

/** The single ui-chrome table this store (and only this store) persists. */
const SIDEBAR_CHROME_TABLE = UI_CHROME_TABLES.sidebarChrome

/**
 * THE slice owning the `sidebar_chrome` table (one table, one writer). The
 * wire DTO carries no version field, so the slice declares the `bare`
 * encoding: format compatibility is expressed by the sanitize/migrate hook
 * that runs on every read and write, and a future format bump extends this
 * definition instead of re-deciding policy at the call site.
 */
const SIDEBAR_CHROME_SLICE: PersistedSliceDefinition<SidebarChromeState> = {
  table: SIDEBAR_CHROME_TABLE,
  scope: 'workspace',
  version: 1,
  encoding: 'bare',
  onIncompatible: 'migrate',
  migrate: raw => sanitizeSidebarChrome(raw),
}

/** Start one persistence facade: subscribe→save, hydrate with merge, flush. */
export function startSidebarChromePersistence(): () => void {
  const handle = persistVia<SidebarChromeState>(
    {
      subscribe: listener => useSidebarChromeStore.subscribe(listener),
      snapshot: chromeSnapshot,
      apply: value => useSidebarChromeStore.setState({ byScope: value.byScope }),
    },
    {
      backend: persistedSliceBackend(
        SIDEBAR_CHROME_SLICE,
        createUiChromeStorage<SidebarChromeState>({
          table: SIDEBAR_CHROME_TABLE,
          defaults: defaultSidebarChromeState,
          sanitize: sanitizeSidebarChrome,
          debounceMs: 250,
        }),
      ),
      merge: mergeSidebarChrome,
    },
  )
  return () => handle.stop()
}
