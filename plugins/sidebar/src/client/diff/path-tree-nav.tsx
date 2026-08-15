/**
 * Path-tree navigation for multi-file diff stacks, built on the shared
 * ListRow primitives (plugins/shared/list-row) — same row shell, geometry,
 * hover and selected styling as the file explorer and the source-control
 * tree. Pure view over prebuilt rows; click a file to scroll to its diff
 * block.
 */
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import { useEffect, useRef } from 'react'
import {
  IconChevronDown,
  IconChevronRight,
} from '../../../../shared/tabler-icons.tsx'
import { FileGlyph } from '../../../../shared/tabler-icons.tsx'
import {
  ListRow,
  ListRowLabel,
  ListRowLabelText,
  ListRowLeading,
  ListRowMain,
  ListRowMeta,
} from '../../../../shared/list-row.tsx'

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
  const containerRef = useRef<HTMLDivElement>(null)

  // Keep a row inside the tree's own scrollport without touching any
  // ancestor scroller (scrollIntoView would scroll the whole column).
  function scrollRowIntoTreeView(rowEl: HTMLElement | null) {
    const container = containerRef.current
    if (!container || !rowEl) return
    const cRect = container.getBoundingClientRect()
    const rRect = rowEl.getBoundingClientRect()
    if (rRect.top >= cRect.top && rRect.bottom <= cRect.bottom) return
    container.scrollTop += rRect.top - cRect.top - (cRect.height - rRect.height) / 2
  }

  const selectedRow = rows.find(row => row.selected === true)
  useEffect(() => {
    const container = containerRef.current
    if (!container || !selectedRow) return
    const rowEl = [...container.querySelectorAll('.oh-dsh-diff-tree-row')]
      .find(el => el.getAttribute('data-path') === selectedRow.path)
    scrollRowIntoTreeView(rowEl as HTMLElement | null)
    // Re-run when the selection moves or the tree structure changes
    // (collapse/expand shifts rows, which can drift the selected row
    // out of the scrollport).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, selectedRow?.path])

  function handleSelectFile(path: string, event: ReactMouseEvent<HTMLElement>) {
    onSelectFile(path)
    const rowEl = (event.currentTarget as HTMLElement).closest('.oh-dsh-diff-tree-row') as HTMLElement | null
    scrollRowIntoTreeView(rowEl)
  }

  return (
    <div ref={containerRef} className="oh-dsh-diff-tree" data-testid="diff-path-tree">
      {rows.map(row => {
        const style = { '--tree-depth': row.depth } as CSSProperties
        if (row.kind === 'directory') {
          return (
            <ListRow
              key={row.key}
              className="oh-dsh-diff-tree-row is-directory"
              style={style}
              data-path={row.path}
              title={row.path}
            >
              <ListRowMain
                aria-expanded={row.collapsed !== true}
                onClick={() => { onToggleDirectory(row.path) }}
              >
                <ListRowLeading>
                  {row.collapsed === true ? <IconChevronRight size={14} /> : <IconChevronDown size={14} />}
                </ListRowLeading>
                <FileGlyph path={row.path} kind="directory" expanded={row.collapsed !== true} />
                <ListRowLabel>
                  <ListRowLabelText>{row.name}</ListRowLabelText>
                </ListRowLabel>
                <ListRowMeta>{row.fileCount}</ListRowMeta>
              </ListRowMain>
            </ListRow>
          )
        }
        return (
          <ListRow
            key={row.key}
            className="oh-dsh-diff-tree-row is-file"
            style={style}
            data-path={row.path}
            title={row.path}
            selected={row.selected === true}
          >
            <ListRowMain onClick={event => { handleSelectFile(row.path, event) }}>
              <ListRowLeading />
              <FileGlyph path={row.path} kind="file" />
              <ListRowLabel>
                <ListRowLabelText>{row.name}</ListRowLabelText>
              </ListRowLabel>
            </ListRowMain>
          </ListRow>
        )
      })}
    </div>
  )
}
