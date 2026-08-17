/**
 * The shared tool-icon glyph set (@oh-dsh/shared).
 *
 * One presentational component for every sidebar tab category (files, Git
 * review, terminal, browser, chat, subagent, trajectory). It lives in the
 * shared kit — not inside any one panel package — because BOTH sidebar
 * surfaces need it: the generic right rail renders descriptor icons, and
 * the desktop add-on's browser tab registers with the same glyph. Keeping
 * it here is what lets the only cross-plugin import be types.
 */
import type { ReactNode } from 'react'

export type ToolIconKind =
  | 'browser'
  | 'chat'
  | 'file'
  | 'files'
  | 'review'
  | 'subagent'
  | 'terminal'
  | 'trajectory'

export function ToolIcon({ kind }: { kind: ToolIconKind }): JSX.Element {
  if (kind === 'review') return <svg viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="16" rx="3" /><path d="M9 9h6M9 13h6M12 7v4" /></svg>
  if (kind === 'terminal') return <svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="3" /><path d="m8 10 2 2-2 2M13 15h3" /></svg>
  if (kind === 'browser') return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></svg>
  if (kind === 'files') return <svg viewBox="0 0 24 24"><path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h4l2 2h6A2.5 2.5 0 0 1 20.5 9.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5z" /></svg>
  if (kind === 'file') return <svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6zM14 3v5h5" /></svg>
  if (kind === 'chat') return <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M11 7v8M7 11h8M16 16l4 4" /></svg>
  if (kind === 'subagent') return <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2.5" /><circle cx="5" cy="18" r="2.5" /><circle cx="19" cy="18" r="2.5" /><path d="M12 7.5v4M5 16v-2.5h14V16M12 11.5 5 15.5M12 11.5l7 4" /></svg>
  return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l-3 2" /></svg>
}

/** Convenience wrapper: an icon node sized by the consumer's CSS. */
export function toolIconOf(kind: ToolIconKind): ReactNode {
  return <ToolIcon kind={kind} />
}
