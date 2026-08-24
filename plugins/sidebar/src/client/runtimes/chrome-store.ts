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

  clearScope: scopeKey => {
    set(state => {
      if (state.byScope[scopeKey] === undefined) return state
      const next = { ...state.byScope }
      delete next[scopeKey]
      return { byScope: next }
    })
  },
}))

const storage = createUiChromeStorage<SidebarChromeState>({
  table: UI_CHROME_TABLES.sidebarChrome,
  defaults: defaultSidebarChromeState,
  sanitize: sanitizeSidebarChrome,
  debounceMs: 250,
})

function snapshot(): SidebarChromeState {
  return { byScope: structuredClone(useSidebarChromeStore.getState().byScope) }
}

/** Start one storage subscriber and hydrate without overwriting early UI work. */
export function startSidebarChromePersistence(): () => void {
  let active = true
  let hydrated = false
  let changedBeforeHydrate = false
  let applyingHydration = false
  const stop = useSidebarChromeStore.subscribe(() => {
    if (applyingHydration) return
    if (hydrated) storage.save(snapshot())
    else changedBeforeHydrate = true
  })
  void storage.load().then(value => {
    if (!active) return
    applyingHydration = true
    const current = useSidebarChromeStore.getState().byScope
    useSidebarChromeStore.setState({
      byScope: changedBeforeHydrate ? { ...value.byScope, ...current } : value.byScope,
    })
    applyingHydration = false
    hydrated = true
    if (changedBeforeHydrate) storage.save(snapshot())
  })
  return () => {
    active = false
    stop()
    void storage.flush()
  }
}
