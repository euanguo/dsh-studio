/**
 * Minimal path-tree navigation for multi-file diff stacks.
 * Pure view over prebuilt rows; click a file to scroll to its diff block.
 */
import type { CSSProperties } from 'react'
import {
  IconChevronDown,
  IconChevronRight,
} from '../../../../shared/tabler-icons.tsx'
import { FileGlyph } from '../../../../shared/tabler-icons.tsx'

export interface DiffPathTreeRow {
  key: string
  kind: 'directory' | 'file'
  path: string
  name: string
  depth: number
  fileCount?: number
  collapsed?: boolean
  selected?: boolean
}

export function DiffPathTreeNav({
  rows,
  onToggleDirectory,
  onSelectFile,
}: {
  rows: readonly DiffPathTreeRow[]
  onToggleDirectory(key: string): void
  onSelectFile(path: string): void
}): JSX.Element {
  return (
    <div className="oh-dsh-diff-tree" data-testid="diff-path-tree">
      {rows.map(row => {
        const style = { '--tree-depth': row.depth } as CSSProperties
        if (row.kind === 'directory') {
          return (
            <div
              key={row.key}
              className="oh-dsh-diff-tree-row is-directory"
              style={style}
              data-path={row.path}
              title={row.path}
            >
              <button
                type="button"
                className="oh-dsh-diff-tree-main"
                aria-expanded={row.collapsed !== true}
                onClick={() => { onToggleDirectory(row.key) }}
              >
                <span className="oh-dsh-diff-tree-chevron">
                  {row.collapsed === true ? <IconChevronRight size={14} /> : <IconChevronDown size={14} />}
                </span>
                <FileGlyph path={row.path} kind="directory" expanded={row.collapsed !== true} />
                <span className="oh-dsh-diff-tree-name">{row.name}</span>
                <span className="oh-dsh-diff-tree-meta">{row.fileCount}</span>
              </button>
            </div>
          )
        }
        return (
          <div
            key={row.key}
            className={`oh-dsh-diff-tree-row is-file${row.selected === true ? ' is-selected' : ''}`}
            style={style}
            data-path={row.path}
            title={row.path}
          >
            <button
              type="button"
              className="oh-dsh-diff-tree-main"
              onClick={() => { onSelectFile(row.path) }}
            >
              <span className="oh-dsh-diff-tree-chevron" />
              <FileGlyph path={row.path} kind="file" />
              <span className="oh-dsh-diff-tree-name">{row.name}</span>
            </button>
          </div>
        )
      })}
    </div>
  )
}
