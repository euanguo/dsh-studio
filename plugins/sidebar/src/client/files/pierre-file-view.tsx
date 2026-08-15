/**
 * Read-only code view on top of `@pierre/diffs`' File component: worker-pool
 * Shiki highlighting + virtualized line rows. Replaces the per-line Prism
 * rendering for text / markdown-source files. Unknown languages and oversized
 * files never reach this component — the caller routes them to the plain-text
 * fallback (see language.ts).
 *
 * Sizing contract: the Virtualizer host must receive a definite height from
 * its flex parent (`oh-dsh-content-root-fill`), otherwise the window never
 * measures and no rows render.
 */
import { useMemo } from 'react'
import { File as PierreFile, Virtualizer } from '@pierre/diffs/react'
import type { FileContents } from '@pierre/diffs'
import { usePierreDiffTheme } from '../diff/pierre-adapter.tsx'

export interface PierreFileViewProps {
  path: string
  content: string
  /** Shiki language id (never 'text' / ''). */
  language: string
  /** Show the line-number gutter (dropped above MAX_NUMBERED_LINES). */
  lineNumbers: boolean
  /** Distinguishes otherwise-identical documents for the worker cache. */
  cacheKey: string
}

export function PierreFileView({
  path,
  content,
  language,
  lineNumbers,
  cacheKey,
}: PierreFileViewProps): JSX.Element {
  const theme = usePierreDiffTheme()
  const file = useMemo<FileContents>(() => ({
    name: path.split(/[\\/]/).filter(Boolean).pop() ?? path,
    contents: content,
    lang: language,
    cacheKey: `view:${cacheKey}`,
  }), [cacheKey, content, language, path])

  return (
    <Virtualizer className="oh-dsh-pierre-file-host" config={{ overscrollSize: 300 }}>
      <PierreFile
        file={file}
        options={{
          disableFileHeader: true,
          disableLineNumbers: !lineNumbers,
          theme,
        }}
      />
    </Virtualizer>
  )
}
