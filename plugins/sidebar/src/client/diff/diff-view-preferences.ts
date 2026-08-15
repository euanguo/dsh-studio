/**
 * Session-scoped diff view preferences (unified/split + word wrap).
 * Mirrors Synara `features/source-control/diff-view-preferences.ts`.
 */
import { create } from 'zustand'

export type { DiffLayoutStyle } from './file-diff.ts'

interface DiffViewPreferencesState {
  layout: 'unified' | 'split'
  wordWrap: boolean
  setLayout(layout: 'unified' | 'split'): void
  toggleLayout(): void
  setWordWrap(wordWrap: boolean): void
  toggleWordWrap(): void
}

export const useDiffViewPreferences = create<DiffViewPreferencesState>((set, get) => ({
  layout: 'unified',
  wordWrap: false,
  setLayout: layout => set({ layout }),
  toggleLayout: () => set({ layout: get().layout === 'unified' ? 'split' : 'unified' }),
  setWordWrap: wordWrap => set({ wordWrap }),
  toggleWordWrap: () => set({ wordWrap: !get().wordWrap }),
}))
