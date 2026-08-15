/**
 * The single diff renderer (ported from the reference project's
 * `components/diff-viewer.tsx`): every diff surface in the plugin renders
 * through DiffViewer — the working-tree diff tab, the commit review and any
 * future diff — so there is exactly one diff component family.
 *
 * The structured DiffDocument is rebuilt into a patch for Pierre; when
 * Pierre cannot parse it (or `rawOnly` is set for comment interactions)
 * the structured RawDiff renderer takes over.
 */
import {
  buildPatch,
  type DiffDocument,
  type DiffLayoutStyle,
  type DiffLine,
} from './file-diff.ts'
import { renderPierreDiff, type PierreDiffTheme } from './pierre-adapter.tsx'

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
  /**
   * Render the structured rows (no Pierre) and make each line clickable.
   * Used by the commit review where lines carry comment targets.
   */
  rawOnly?: boolean
  onLineClick?: (line: DiffLine) => void
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
  rawOnly = false,
  onLineClick,
  cacheBust,
}: DiffViewerProps): JSX.Element {
  const summary = `${document.path}  +${String(document.additions)} −${String(document.deletions)}`
  const patch = buildPatch(document)

  if (rawOnly || onLineClick !== undefined) {
    return (
      <div className="oh-dsh-diff-viewer" data-testid="diff-viewer" data-layout={layout}>
        {hideMeta ? null : (
          <div className="oh-dsh-diff-viewer-meta">
            <span>{summary}</span>
          </div>
        )}
        <RawDiff
          document={document}
          wordWrap={wordWrap}
          {...(onLineClick === undefined ? {} : { onLineClick })}
        />
      </div>
    )
  }

  const renderedDiff = renderPierreDiff({
    patch,
    cacheKey: `workspace:${document.path}:${layout}:${wordWrap ? 'wrap' : 'scroll'}:${virtualize ? 'v' : 'n'}:${cacheBust ?? ''}`,
    theme,
    surfaceClassName: virtualize ? 'oh-dsh-pierre-surface' : 'oh-dsh-pierre-surface-natural',
    layout,
    wordWrap,
    virtualize,
  })

  if (renderedDiff === null) {
    return (
      <div className="oh-dsh-diff-viewer" data-testid="diff-viewer" data-layout={layout}>
        {hideMeta ? null : (
          <div className="oh-dsh-diff-viewer-meta">
            <span>{summary}</span>
          </div>
        )}
        <RawDiff document={document} wordWrap={wordWrap} />
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

/** Structured row renderer (the Pierre-less fallback / comment surface). */
export function RawDiff({
  document,
  wordWrap,
  onLineClick,
}: {
  document: DiffDocument
  wordWrap: boolean
  onLineClick?: (line: DiffLine) => void
}): JSX.Element {
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
        const content = onLineClick !== undefined
          ? (
            <button
              type="button"
              className="oh-dsh-diff-raw-row"
              data-line-kind={line.kind}
              title={line.oldLine === null && line.newLine === null ? undefined : String(line.oldLine ?? line.newLine)}
              onClick={() => { onLineClick(line) }}
            >
              {row}
            </button>
          )
          : (
            <div className="oh-dsh-diff-raw-row" data-line-kind={line.kind}>
              {row}
            </div>
          )
        return <li key={`${document.path}-${index + 1}`}>{content}</li>
      })}
    </ol>
  )
}
