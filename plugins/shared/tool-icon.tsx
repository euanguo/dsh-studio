/**
 * Sidebar tab category glyphs. Maps each tool kind onto the installed
 * Tabler set so the right rail and desktop add-on share one weight.
 */
import type { ReactNode } from 'react'
import {
  IconFile,
  IconFolderOpen,
  IconGitBranch,
  IconList,
  IconMessagePlus,
  IconTerminal,
  IconWorld,
} from './tabler-icons.tsx'

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
  if (kind === 'review') return <IconGitBranch />
  if (kind === 'terminal') return <IconTerminal />
  if (kind === 'browser') return <IconWorld />
  if (kind === 'files') return <IconFolderOpen />
  if (kind === 'file') return <IconFile />
  if (kind === 'chat') return <IconMessagePlus />
  if (kind === 'subagent') return <IconList />
  return <IconList />
}

/** Convenience wrapper: an icon node sized by the consumer's CSS. */
export function toolIconOf(kind: ToolIconKind): ReactNode {
  return <ToolIcon kind={kind} />
}
