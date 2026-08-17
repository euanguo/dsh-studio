/**
 * Colored file/directory glyphs (VSCode Material style via
 * `@react-symbols/icons`). Chrome icons live in official primitives or
 * `plugins/shared/icons.tsx`.
 */
import type { ReactNode } from 'react'
import { IconLinkOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  DefaultFolderOpenedIcon,
  getIconForFile,
  getIconForFolder,
} from '@react-symbols/icons/utils'

const DEFAULT_SIZE = 16

export type FileGlyphKind = 'directory' | 'file' | 'symlink'

/** Colored file/directory glyph (VSCode Material style, 16px). */
export function FileGlyph({
  path,
  kind,
  expanded = false,
  className,
}: {
  path: string
  kind: FileGlyphKind
  expanded?: boolean
  className?: string
}): JSX.Element {
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? 'file'
  const wrap = (icon: ReactNode): JSX.Element => (
    <span className={className} aria-hidden="true" data-icon-vendor="react-symbols">
      {icon}
    </span>
  )
  if (kind === 'directory') {
    if (expanded) {
      return wrap(<DefaultFolderOpenedIcon width={DEFAULT_SIZE} height={DEFAULT_SIZE} />)
    }
    return wrap(getIconForFolder({
      folderName: name,
      width: DEFAULT_SIZE,
      height: DEFAULT_SIZE,
    }))
  }
  if (kind === 'symlink') {
    return (
      <span className={className} aria-hidden="true">
        <IconLinkOutline16 size={DEFAULT_SIZE} />
      </span>
    )
  }
  return wrap(getIconForFile({
    fileName: name,
    autoAssign: true,
    width: DEFAULT_SIZE,
    height: DEFAULT_SIZE,
  }))
}
