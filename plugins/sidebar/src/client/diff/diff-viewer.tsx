/**
 * The single diff renderer (ported from the reference project's
 * `components/diff-viewer.tsx`): every diff surface in the plugin renders
 * through DiffViewer — the working-tree diff tab, the commit review and any
 * future diff — so there is exactly one diff component family.
 *
 * The structured DiffDocument is rebuilt into a patch for Pierre; when
 * Pierre cannot parse it, the structured RawDiff renderer takes over as the
 * fallback. Line comments render as Pierre annotation rows (lineAnnotations
 * + renderAnnotation) on the new-side lines.
 */
import type { ReactNode } from 'react'
import type { AnnotationSide, DiffLineAnnotation } from '@pierre/diffs'
import {
  buildPatch,
  type DiffDocument,
  type DiffLayoutStyle,
} from './file-diff.ts'
import { renderPierreDiff, type PierreDiffTheme } from './pierre-adapter.tsx'
import type { DiffComment } from './diff-comments-store.ts'

export type DiffViewerProps = Readonly<{
  document: DiffDocument
  theme: PierreDiffTheme
  layout?: DiffLayoutStyle
  wordWrap?: boolean
  /** Hide the meta strip when an outer header already shows path/stats. */
  hideMeta?: boolean
  /**
   * When false, Pierre content sizes to its lines so an outer multi-diff list
   * can scroll the full stack. Default true for single-file center surfaces.
   */
  virtualize?: boolean
  /** Line comments rendered as Pierre annotation rows (new-side lines). */
  lineAnnotations?: DiffLineAnnotation<DiffComment>[]
  renderAnnotation?: (annotation: DiffLineAnnotation<DiffComment>) => ReactNode
  /** Clicking a line-number gutter reports the line (prefills the comment form). */
  onLineNumberClick?: (input: { lineNumber: number; side: AnnotationSide }) => void
  /**
   * Extra cache-key input: distinguishes otherwise-identical documents
   * (same path) whose rendered content differs — e.g. the same file's
   * staged vs unstaged diff. Without it the worker highlight cache can
   * return the previous document's tokens.
   */
  cacheBust?: string
}>

export function DiffViewer({
  document,
  theme,
  layout = 'unified',
  wordWrap = false,
  hideMeta = false,
  virtualize = true,
  lineAnnotations,
  renderAnnotation,
  onLineNumberClick,
  cacheBust,
}: DiffViewerProps): JSX.Element {
  const summary = `${document.path}  +${String(document.additions)} −${String(document.deletions)}`
  const patch = buildPatch(document)

  const renderedDiff = renderPierreDiff({
    patch,
    cacheKey: `workspace:${document.path}:${layout}:${wordWrap ? 'wrap' : 'scroll'}:${virtualize ? 'v' : 'n'}:${cacheBust ?? ''}`,
    theme,
    surfaceClassName: virtualize ? 'oh-dsh-pierre-surface' : 'oh-dsh-pierre-surface-natural',
    layout,
    wordWrap,
    virtualize,
    ...(lineAnnotations === undefined ? {} : { lineAnnotations }),
    ...(renderAnnotation === undefined ? {} : { renderAnnotation }),
    ...(onLineNumberClick === undefined ? {} : { onLineNumberClick }),
  })

  if (renderedDiff === null) {
    return (
      <div className="oh-dsh-diff-viewer" data-testid="diff-viewer" data-layout={layout}>
        {hideMeta ? null : (
          <div className="oh-dsh-diff-viewer-meta">
            <span>{summary}</span>
          </div>
        )}
        <RawDiff document={document} wordWrap={wordWrap} layout={layout} />
      </div>
    )
  }

  return (
    <div
      className="oh-dsh-diff-viewer"
      data-testid="diff-viewer"
      data-layout={layout}
      data-virtualize={virtualize ? 'on' : 'off'}
    >
      {hideMeta ? null : (
        <div className="oh-dsh-diff-viewer-meta">
          <span>{summary}</span>
        </div>
      )}
      {renderedDiff}
    </div>
  )
}

/** Structured row renderer (the Pierre-less fallback when the patch cannot be parsed). */
export function RawDiff({
  document,
  wordWrap,
  layout = 'unified',
}: {
  document: DiffDocument
  wordWrap: boolean
  layout?: DiffLayoutStyle
}): JSX.Element {
  if (layout === 'split') {
    return (
      <ol className="oh-dsh-diff-raw-lines oh-dsh-diff-raw-lines-split" data-wrap={wordWrap ? 'on' : 'off'}>
        {document.lines.map((line, index) => {
          const leftText = line.kind === 'added' ? '' : line.displayText
          const rightText = line.kind === 'removed' ? '' : line.displayText
          const leftLabel = line.oldLineLabel
          const rightLabel = line.newLineLabel
          return (
            <li key={`${document.path}-${index + 1}`} data-line-kind={line.kind}>
              <div className="oh-dsh-diff-raw-row">
                <span className="oh-dsh-diff-raw-gutter">{leftLabel}</span>
                <code className="oh-dsh-diff-raw-code">{leftText}</code>
                <span className="oh-dsh-diff-raw-gutter">{rightLabel}</span>
                <code className="oh-dsh-diff-raw-code">{rightText}</code>
              </div>
            </li>
          )
        })}
      </ol>
    )
  }
  return (
    <ol className="oh-dsh-diff-raw-lines" data-wrap={wordWrap ? 'on' : 'off'}>
      {document.lines.map((line, index) => {
        const row = (
          <>
            <span className="oh-dsh-diff-raw-gutter">{line.oldLineLabel}</span>
            <span className="oh-dsh-diff-raw-gutter">{line.newLineLabel}</span>
            <code>{line.displayText}</code>
          </>
        )
        return (
          <li key={`${document.path}-${index + 1}`}>
            <div className="oh-dsh-diff-raw-row" data-line-kind={line.kind}>{row}</div>
          </li>
        )
      })}
    </ol>
  )
}
