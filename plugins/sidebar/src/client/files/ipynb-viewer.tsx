/**
 * Lightweight Jupyter notebook viewer: parses the ipynb JSON and renders
 * markdown cells (react-markdown) and code cells (read-only source blocks).
 * No new dependencies — the JSON parse is part of the viewer.
 */
import { MarkdownViewer } from './markdown-viewer.tsx'
import { parseIpynb, type IpynbCell } from './ipynb-parse.ts'
import { EmptyState, ErrorState } from '@dsh-studio/shared/ui'

function cellSource(cell: IpynbCell): string {
  return Array.isArray(cell.source) ? cell.source.join('') : cell.source
}

export function IpynbViewer({ content }: { content: string }): JSX.Element {
  const { cells, error } = parseIpynb(content)
  if (error !== null) {
    return <ErrorState message={error} />
  }
  return (
    <div className="dsh-studio-ipynb-viewer" data-testid="ipynb-viewer">
      {cells.map((cell, index) => (
        <div key={index} className="dsh-studio-ipynb-cell" data-cell-type={cell.cell_type}>
          <div className="dsh-studio-ipynb-cell-label">
            {cell.cell_type === 'code' ? `In [${index + 1}]` : cell.cell_type}
          </div>
          {cell.cell_type === 'markdown' ? (
            <div className="dsh-studio-ipynb-markdown">
              <MarkdownViewer content={cellSource(cell)} taskTogglesEnabled={false} />
            </div>
          ) : (
            <pre className="dsh-studio-ipynb-source">
              <code>{cellSource(cell)}</code>
            </pre>
          )}
        </div>
      ))}
      {cells.length === 0 ? <EmptyState title="Empty notebook" /> : null}
    </div>
  )
}
