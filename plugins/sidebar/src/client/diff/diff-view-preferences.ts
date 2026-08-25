/**
 * Diff rendering preferences (unified/split + word wrap), persisted per
 * workspace through the sidebar chrome store (F10 / Q5). The former
 * session-scoped Synara mirror is ABANDONED: diff prefs now ride the same
 * domain-backed `sidebarChrome` slice as the rest of the sidebar UI state,
 * so they survive reloads and follow the active workspace like the diff
 * panel itself.
 */
import { useSidebarChromeStore } from '../runtimes/chrome-store.ts'
import { defaultSidebarChromeSlice } from '@dsh-studio/shared/ui-chrome-tables'

export type { DiffLayoutStyle } from './file-diff.ts'

const DEFAULT_DIFF_VIEW = defaultSidebarChromeSlice().diffView

export interface DiffViewControls {
  layout: 'unified' | 'split'
  wordWrap: boolean
  toggleLayout(): void
  toggleWordWrap(): void
}

/** The diff-view preferences for one workspace (cwd), persisted in chrome. */
export function useDiffViewPreferences(cwd: string | undefined): DiffViewControls {
  const diffView = useSidebarChromeStore(
    state => (cwd === undefined ? DEFAULT_DIFF_VIEW : state.byScope[cwd]?.diffView ?? DEFAULT_DIFF_VIEW),
  )
  return {
    layout: diffView.layout,
    wordWrap: diffView.wordWrap,
    toggleLayout: () => {
      if (cwd === undefined) return
      const next = diffView.layout === 'unified' ? 'split' : 'unified'
      useSidebarChromeStore.getState().setDiffViewLayout(cwd, next)
    },
    toggleWordWrap: () => {
      if (cwd === undefined) return
      useSidebarChromeStore.getState().setDiffViewWordWrap(cwd, !diffView.wordWrap)
    },
  }
}