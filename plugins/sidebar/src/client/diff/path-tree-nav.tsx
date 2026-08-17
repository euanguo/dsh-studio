/**
 * Path-tree navigation for multi-file diff stacks, built on the shared
 * ListRow primitives (plugins/shared/list-row) — same row shell, geometry,
 * hover and selected styling as the file explorer and the source-control
 * tree. Pure view over prebuilt rows; click a file to scroll to its diff
 * block. The row list is virtualized (uniform 28px rows) so deep trees
 * never render every row.
 */
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  IconChevronDown,
  IconChevronRight,
} from '@oh-dsh/shared/tabler-icons'
import { FileGlyph } from '@oh-dsh/shared/tabler-icons'
import { Scrollable } from '@oh-dsh/shared/scrollable'
import {
  ListRow,
  ListRowLabel,
  ListRowLabelText,
  ListRowLeading,
  ListRowMain,
  ListRowMeta,
} from '@oh-dsh/shared/list-row'

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

/** Row slot height: shared ListRow row (28px) + its 4px rhythm margin.
    The margin lives on the slot wrapper (see .oh-dsh-diff-tree-slot), not
    on the ListRow itself — every virtualized row is the only child of its
    absolutely-positioned wrapper, so ListRow's own :last-child rule would
    zero it. The virtualizer must allocate the full footprint or rows cram. */
const ROW_HEIGHT_PX = 32

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
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 10,
  })

  const selectedIndex = rows.findIndex(row => row.selected === true)

  // Keep the selected row inside the tree's own scrollport without touching
  // any ancestor scroller (scrollIntoView would scroll the whole column).
  useEffect(() => {
    if (selectedIndex < 0) return
    const visible = virtualizer.getVirtualItems()
    const isVisible = visible.some(item => item.index === selectedIndex)
    if (isVisible) return
    virtualizer.scrollToIndex(selectedIndex, { align: 'center' })
    // Re-run when the selection moves or the tree structure changes
    // (collapse/expand shifts rows, which can drift the selected row
    // out of the scrollport).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, selectedIndex])

  function handleSelectFile(path: string) {
    onSelectFile(path)
    const index = rows.findIndex(row => row.path === path)
    if (index < 0) return
    const visible = virtualizer.getVirtualItems()
    if (!visible.some(item => item.index === index)) {
      virtualizer.scrollToIndex(index, { align: 'center' })
    }
  }

  return (
    <Scrollable ref={containerRef} className="oh-dsh-diff-tree" data-testid="diff-path-tree">
      <div
        className="oh-dsh-diff-tree-inner"
        style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
      >
        {virtualizer.getVirtualItems().map(item => {
          const row = rows[item.index]
          if (row === undefined) return null
          const style = {
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${String(item.start)}px)`,
            '--tree-depth': row.depth,
          } as CSSProperties
          if (row.kind === 'directory') {
            return (
              <div key={row.key} className="oh-dsh-diff-tree-slot" style={style}>
                <ListRow
                  className="oh-dsh-diff-tree-row is-directory"
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
              </div>
            )
          }
          return (
            <div key={row.key} className="oh-dsh-diff-tree-slot" style={style}>
              <ListRow
                className="oh-dsh-diff-tree-row is-file"
                data-path={row.path}
                title={row.path}
                selected={row.selected === true}
              >
                <ListRowMain onClick={() => { handleSelectFile(row.path) }}>
                  <ListRowLeading />
                  <FileGlyph path={row.path} kind="file" />
                  <ListRowLabel>
                    <ListRowLabelText>{row.name}</ListRowLabelText>
                  </ListRowLabel>
                </ListRowMain>
              </ListRow>
            </div>
          )
        })}
      </div>
    </Scrollable>
  )
}
