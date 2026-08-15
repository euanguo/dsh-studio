/**
 * Sidebar UI chrome store (ported from the reference project's
 * `scope/workspace-chrome-store.ts` pattern).
 *
 * Holds UI-only state — expanded directories, collapsed sections,
 * selections, list modes — per sidebar scope (`sessionId:cwd`), persisted
 * to localStorage. Data NEVER lives here: it belongs to the runtimes.
 * Views read chrome + runtime snapshots separately.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface ExplorerChromeSlice {
  expandedPaths: readonly string[]
  selectedPath: string | null
}

export interface SourceControlChromeSlice {
  collapsedSections: readonly string[]
  collapsedDirectories: readonly string[]
  selectedPath: string | null
}

export type GitListMode = 'tree' | 'flat'

export interface SidebarChromeSlice {
  explorer: ExplorerChromeSlice
  sourceControl: SourceControlChromeSlice
  gitListMode: GitListMode
}

const DEFAULT_SLICE: SidebarChromeSlice = {
  explorer: { expandedPaths: [], selectedPath: null },
  sourceControl: { collapsedSections: [], collapsedDirectories: [], selectedPath: null },
  gitListMode: 'tree',
}

interface SidebarChromeState {
  byScope: Readonly<Record<string, SidebarChromeSlice | undefined>>
  getSlice: (scopeKey: string) => SidebarChromeSlice
  setExplorerSelectedPath: (scopeKey: string, path: string | null) => void
  toggleExplorerDirectory: (scopeKey: string, path: string) => void
  setSourceControlSelectedPath: (scopeKey: string, path: string | null) => void
  toggleSourceControlSection: (scopeKey: string, id: string) => void
  toggleSourceControlDirectory: (scopeKey: string, key: string) => void
  setGitListMode: (scopeKey: string, mode: GitListMode) => void
  clearScope: (scopeKey: string) => void
}

function readSlice(
  state: Pick<SidebarChromeState, 'byScope'>,
  scopeKey: string,
): SidebarChromeSlice {
  return state.byScope[scopeKey] ?? DEFAULT_SLICE
}

function writeSlice(
  state: Pick<SidebarChromeState, 'byScope'>,
  scopeKey: string,
  slice: SidebarChromeSlice,
): SidebarChromeState['byScope'] {
  return {
    ...state.byScope,
    [scopeKey]: slice,
  }
}

function toggleInList(list: readonly string[], value: string): readonly string[] {
  return list.includes(value) ? list.filter(item => item !== value) : [...list, value]
}

export const useSidebarChromeStore = create<SidebarChromeState>()(
  persist(
    (set, get) => ({
      byScope: {},

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
    }),
    {
      name: 'oh-dsh-desktop.sidebar-chrome',
      version: 1,
    },
  ),
)
