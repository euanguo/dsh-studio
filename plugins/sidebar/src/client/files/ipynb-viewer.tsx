/**
 * Lightweight Jupyter notebook viewer: parses the ipynb JSON and renders
 * markdown cells (react-markdown) and code cells (read-only source blocks).
 * No new dependencies — the JSON parse is part of the viewer.
 */
import { MarkdownViewer } from './markdown-viewer.tsx'
import { parseIpynb, type IpynbCell } from './ipynb-parse.ts'

function cellSource(cell: IpynbCell): string {
  return Array.isArray(cell.source) ? cell.source.join('') : cell.source
}

export function IpynbViewer({ content }: { content: string }): JSX.Element {
  const { cells, error } = parseIpynb(content)
  if (error !== null) {
    return <div className="oh-dsh-side-error" role="alert">{error}</div>
  }
  return (
    <div className="oh-dsh-ipynb-viewer" data-testid="ipynb-viewer">
      {cells.map((cell, index) => (
        <div key={index} className="oh-dsh-ipynb-cell" data-cell-type={cell.cell_type}>
          <div className="oh-dsh-ipynb-cell-label">
            {cell.cell_type === 'code' ? `In [${index + 1}]` : cell.cell_type}
          </div>
          {cell.cell_type === 'markdown' ? (
            <div className="oh-dsh-ipynb-markdown">
              <MarkdownViewer content={cellSource(cell)} taskTogglesEnabled={false} />
            </div>
          ) : (
            <pre className="oh-dsh-ipynb-source">
              <code>{cellSource(cell)}</code>
            </pre>
          )}
        </div>
      ))}
      {cells.length === 0 ? <div className="oh-dsh-side-muted">Empty notebook</div> : null}
    </div>
  )
}
