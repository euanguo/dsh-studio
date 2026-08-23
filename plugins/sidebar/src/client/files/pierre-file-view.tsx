/**
 * Read-only code view on top of `@pierre/diffs`' File component: worker-pool
 * Shiki highlighting + virtualized line rows. Replaces the per-line Prism
 * rendering for text / markdown-source files. Unknown languages and oversized
 * files never reach this component — the caller routes them to the plain-text
 * fallback (see language.ts).
 *
 * Sizing contract: the Virtualizer host must receive a definite height from
 * its flex parent (`dsh-studio-content-root-fill`), otherwise the window never
 * measures and no rows render.
 */
import { useMemo } from 'react'
import { File as PierreFile, Virtualizer } from '@pierre/diffs/react'
import type { CommentRails } from '../comments/comment-rails.tsx'
import type { FileContents, LineAnnotation } from '@pierre/diffs'
import { usePierreDiffTheme } from '../diff/pierre-adapter.tsx'
import { basename } from '@dsh-studio/shared/path'
import type { WorkbenchComment } from '../diff/diff-comments-store.ts'
import { CommentBubble } from '../diff/comment-bubble.tsx'

export interface PierreFileViewProps {
  path: string
  content: string
  /** Shiki language id; 'text' renders plain rows (unknown languages). */
  language: string
  /** Show the line-number gutter (dropped above MAX_NUMBERED_LINES). */
  lineNumbers: boolean
  /** Distinguishes otherwise-identical documents for the worker cache. */
  cacheKey: string
  /** Line comments rendered as annotation rows at their file lines. */
  comments?: readonly WorkbenchComment[]
  /** Hover-comment rails wiring (gutter "+" + composer overlay). */
  rails?: CommentRails
}

export function PierreFileView({
  path,
  content,
  language,
  lineNumbers,
  cacheKey,
  comments,
  rails,
}: PierreFileViewProps): JSX.Element {
  const theme = usePierreDiffTheme()
  const file = useMemo<FileContents>(() => ({
    name: basename(path),
    contents: content,
    lang: language,
    cacheKey: `view:${cacheKey}`,
  }), [cacheKey, content, language, path])

  const lineAnnotations = useMemo<Array<LineAnnotation<WorkbenchComment>> | undefined>(
    () => (comments === undefined || comments.length === 0
      ? undefined
      : comments.map(comment => ({ lineNumber: comment.startLine, metadata: comment }))),
    [comments],
  )

  return (
    <Virtualizer className="dsh-studio-pierre-file-host" config={{ overscrollSize: 300 }}>
      {rails?.overlay()}
      <PierreFile
        file={file}
        options={{
          disableFileHeader: true,
          disableLineNumbers: !lineNumbers,
          theme,
        }}
        {...(lineAnnotations === undefined
          ? {}
          : {
              lineAnnotations,
              renderAnnotation: (annotation: LineAnnotation<WorkbenchComment>) => (
                <CommentBubble comment={annotation.metadata} />
              ),
            })}
        {...(rails === undefined
          ? {}
          : {
              onLineEnter: rails.onLineEnter,
              onLineLeave: rails.onLineLeave,
            })}
        {...(rails === undefined
          ? {}
          : { renderGutterUtility: rails.gutterUtility })}
      />
    </Virtualizer>
  )
}
