// // unwired-capability (leaf-R1 ①): restored arrow-key history mapping for the
// // composer input. Not reached while composer history is dormant; kept as a
// // pure, unit-tested helper.
import type { InputHistoryDirection } from './input-history.ts'

export interface ComposerCaret {
  readonly selectionEnd: number | null
  readonly selectionStart: number | null
  readonly value: string
}
export interface ComposerHistoryKey {
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly isComposing: boolean
  readonly key: string
  readonly metaKey: boolean
  readonly shiftKey: boolean
}

/** Return a history direction only for unmodified, non-IME arrow keys. */
export function historyDirectionForKey(event: ComposerHistoryKey): InputHistoryDirection | null {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return null
  if (event.key === 'ArrowUp') return 'older'
  if (event.key === 'ArrowDown') return 'newer'
  return null
}

/** Manual drafts retain normal arrow-key behavior; recalled history can keep browsing at its edges. */
export function isAtHistoryBoundary(
  input: ComposerCaret,
  direction: InputHistoryDirection,
  browsingHistory = false,
): boolean {
  const { selectionStart, selectionEnd, value } = input
  if (value !== '' && !browsingHistory) return false
  if (selectionStart === null || selectionEnd === null || selectionStart !== selectionEnd) return false
  return direction === 'older' ? selectionStart === 0 : selectionEnd === value.length
}
