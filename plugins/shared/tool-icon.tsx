/**
 * Sidebar tab category glyphs. Maps each tool kind onto an official
 * primitives icon so the right rail and desktop add-on share one set.
 */
import type { ReactNode } from 'react'
import {
  IconAgentPresetOutline16,
  IconBranchOutline16,
  IconBrowseOutline16,
  IconCodeOutline16,
  IconFolderClose16,
  IconFolderOpenOutline16,
  IconListPenOutline16,
  IconNewChatOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'

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
  if (kind === 'review') return <IconBranchOutline16 />
  if (kind === 'terminal') return <IconCodeOutline16 />
  if (kind === 'browser') return <IconBrowseOutline16 />
  if (kind === 'files') return <IconFolderOpenOutline16 />
  if (kind === 'file') return <IconFolderClose16 />
  if (kind === 'chat') return <IconNewChatOutline16 />
  if (kind === 'subagent') return <IconAgentPresetOutline16 />
  return <IconListPenOutline16 />
}

/** Convenience wrapper: an icon node sized by the consumer's CSS. */
export function toolIconOf(kind: ToolIconKind): ReactNode {
  return <ToolIcon kind={kind} />
}
