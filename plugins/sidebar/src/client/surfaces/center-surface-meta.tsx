/** Center surface panel shared helpers: icons, labels and the empty slice. */
import {
  IconExternalLink,
  IconFile,
  IconFileDiff,
  IconGitBranch,
  IconGitCommit,
  IconHistory,
  IconTerminal,
  getIconForFile,
} from '@dsh-studio/shared/tabler-icons'
import type { CenterSurface, CenterSurfaceSlice } from './types.ts'

/** Extract the file basename from a path for icon lookup. */
function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? 'file'
}

/** File-type icon matching the right-panel file tree (VSCode Material style). */
function fileTypeIcon(filePath: string): JSX.Element {
  return getIconForFile({ fileName: fileNameFromPath(filePath), autoAssign: true, width: 13, height: 13 })
}

/** Tab icon per surface kind. */
export function surfaceIcon(surface: CenterSurface): JSX.Element | null {
  if (surface.kind === 'conversation') return <IconFile size={13} />
  if (surface.kind === 'file') return fileTypeIcon(surface.filePath)
  if (surface.kind === 'diff') return <IconGitBranch size={13} />
  if (surface.kind === 'diff-all') return <IconGitBranch size={13} />
  if (surface.kind === 'commit') return <IconHistory size={13} />
  if (surface.kind === 'commit-file') return <IconFileDiff size={13} />
  if (surface.kind === 'committed') return <IconGitCommit size={13} />
  if (surface.kind === 'browser') return <IconExternalLink size={13} />
  if (surface.kind === 'terminal') return <IconTerminal size={13} />
  return null
}

function sessionShortId(sessionId: string): string {
  return `#${sessionId.replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase() || '?'}`
}

/** Human tab label for a conversation: the session title, then the project
 *  basename, then the raw id (matches the host's displayTitle projection). */
export function conversationTabTitle(
  sessionId: string,
  cwd: string | undefined,
  summary?: { title?: string; displayTitle?: string },
): string {
  if (summary?.displayTitle !== undefined && summary.displayTitle !== '') {
    return summary.displayTitle
  }
  if (summary?.title !== undefined && summary.title !== '') {
    return summary.title
  }
  if (cwd !== undefined && cwd !== '') {
    const base = cwd.replaceAll('\\', '/').replace(/\/+$/, '').split('/').at(-1)
    if (base !== undefined && base !== '') return base
  }
  return sessionShortId(sessionId)
}

/** Empty slice used while no workspace is active. */
export const EMPTY_CENTER_SLICE: CenterSurfaceSlice = { open: [], activeId: null }

