/**
 * Lightweight Jupyter notebook viewer: parses the ipynb JSON and renders
 * markdown cells (react-markdown) and code cells (read-only source blocks).
 * No new dependencies — the JSON parse is part of the viewer.
 */
import { SidebarSurfaceCss as surfaceCss } from '../styles.js'
import { MarkdownViewer } from './markdown-viewer.tsx'
import { parseIpynb, type IpynbCell } from './ipynb-parse.ts'
import type { Translate } from '@dsh-studio/shared/i18n'
import type { WorkspaceMessage } from '../i18n.ts'
import { EmptyState, ErrorState } from '@dsh-studio/shared/ui'

function cellSource(cell: IpynbCell): string {
  return Array.isArray(cell.source) ? cell.source.join('') : cell.source
}

export function IpynbViewer({ content, t }: { content: string; t: Translate<WorkspaceMessage> }): JSX.Element {
  const { cells, error } = parseIpynb(content)
  if (error !== null) {
    return <ErrorState message={error} />
  }
  return (
    <div className={surfaceCss["dsh-studio-ipynb-viewer"]} data-testid="ipynb-viewer">
      {cells.map((cell, index) => (
        <div key={index} className={surfaceCss["dsh-studio-ipynb-cell"]} data-cell-type={cell.cell_type}>
          <div className={surfaceCss["dsh-studio-ipynb-cell-label"]}>
            {cell.cell_type === 'code' ? `In [${index + 1}]` : cell.cell_type}
          </div>
          {cell.cell_type === 'markdown' ? (
            <div className={surfaceCss["dsh-studio-ipynb-markdown"]}>
              <MarkdownViewer content={cellSource(cell)} taskTogglesEnabled={false} t={t} />
            </div>
          ) : (
            <pre className={surfaceCss["dsh-studio-ipynb-source"]}>
              <code>{cellSource(cell)}</code>
            </pre>
          )}
        </div>
      ))}
      {cells.length === 0 ? <EmptyState title={t('files.empty-notebook')} /> : null}
    </div>
  )
}
