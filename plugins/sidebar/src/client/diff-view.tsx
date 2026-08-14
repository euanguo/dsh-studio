/**
 * Line-level unified/split diff view (reference-project visual style):
 * hunk headers, old/new line-number gutters, add/del/context coloring,
 * optional soft wrap. Data comes from `parseUnifiedDiff`.
 */
import type { ParsedDiff, DiffLine } from './parse-unified-diff.ts'

export type DiffLayoutStyle = 'unified' | 'split'

function DiffLineRow({ line }: { line: DiffLine }): JSX.Element {
  return (
    <div className={`oh-dsh-diff-line is-${line.type}`}>
      <span className="oh-dsh-diff-gutter">{line.oldLine ?? ''}</span>
      <span className="oh-dsh-diff-gutter">{line.newLine ?? ''}</span>
      <code>{line.content === '' ? ' ' : line.content}</code>
    </div>
  )
}

/** Split view: interleave old/new columns with empty cells for missing sides. */
function splitColumns(lines: readonly DiffLine[]): Array<{
  oldLine: DiffLine | null
  newLine: DiffLine | null
}> {
  const columns: Array<{ oldLine: DiffLine | null; newLine: DiffLine | null }> = []
  for (const line of lines) {
    if (line.type === 'deletion') {
      columns.push({ oldLine: line, newLine: null })
    } else if (line.type === 'addition') {
      columns.push({ oldLine: null, newLine: line })
    } else {
      columns.push({ oldLine: line, newLine: line })
    }
  }
  return columns
}

export function DiffView({
  diff,
  layout = 'unified',
  wordWrap = false,
  className,
}: {
  diff: ParsedDiff
  layout?: DiffLayoutStyle
  wordWrap?: boolean
  className?: string
}): JSX.Element {
  const wrap = wordWrap === true
  return (
    <div
      className={`oh-dsh-diff-view${layout === 'split' ? ' is-split' : ''}${wrap ? ' is-wrap' : ''}${className === undefined ? '' : ` ${className}`}`}
    >
      {diff.hunks.map((hunk, hunkIndex) => (
        <div className="oh-dsh-diff-hunk" key={hunkIndex}>
          <div className="oh-dsh-diff-hunk-header">{hunk.header}</div>
          {layout === 'split'
            ? (
              <div className="oh-dsh-diff-split">
                {splitColumns(hunk.lines).map((pair, lineIndex) => (
                  <div className="oh-dsh-diff-split-row" key={lineIndex}>
                    <div className={`oh-dsh-diff-split-cell${pair.oldLine === null ? ' is-empty' : ''}`}>
                      {pair.oldLine !== null && (
                        <>
                          <span className="oh-dsh-diff-gutter">{pair.oldLine.oldLine ?? ''}</span>
                          <code className={`is-${pair.oldLine.type}`}>
                            {pair.oldLine.content === '' ? ' ' : pair.oldLine.content}
                          </code>
                        </>
                      )}
                    </div>
                    <div className={`oh-dsh-diff-split-cell${pair.newLine === null ? ' is-empty' : ''}`}>
                      {pair.newLine !== null && (
                        <>
                          <span className="oh-dsh-diff-gutter">{pair.newLine.newLine ?? ''}</span>
                          <code className={`is-${pair.newLine.type}`}>
                            {pair.newLine.content === '' ? ' ' : pair.newLine.content}
                          </code>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
            : hunk.lines.map((line, lineIndex) => (
              <DiffLineRow key={lineIndex} line={line} />
            ))}
        </div>
      ))}
    </div>
  )
}
