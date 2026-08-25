/**
 * Files-tree rendering for the files browser: the ListRow row stream, the
 * inline create-editor row, plus the row / background context menus and
 * their pixel anchoring. The scroll list owns tree-only local state (which
 * popup is open) and calls back into the parent for every mutation/open.
 * Extracted from files-view.tsx — behavior unchanged.
 */
import { useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { Input, Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@dsh-studio/shared/i18n'
import {
  FileGlyph,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconDots,
  IconEdit,
  IconEye,
  IconFilePlus,
  IconFolderPlus,
  IconRefresh,
  IconTrash,
} from '@dsh-studio/shared/tabler-icons'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  ListRow,
  ListRowActionButton,
  ListRowActions,
  ListRowBody,
  ListRowLeading,
  ListRowMain,
  ListRowTrailing,
  ScrollArea,
} from '@dsh-studio/shared/ui'
import { FilenameLabel } from '@dsh-studio/shared/filename-label'
import type { OpenIntent } from '@dsh-studio/shared/workbench-contracts'
import { useSidebarChromeStore } from '../runtimes/chrome-store.ts'
import type { WorkspaceMessage } from '../i18n.ts'
import { SidebarSurfaceCss as surfaceCss } from '../styles.js'
import type { FileRow } from './file-tree-model.ts'

/** Human-readable byte count used for the size column and the viewer empty
 *  state (also imported by file-view-host). */
export function formatSize(size: number | null): string {
  if (size === null) return ''
  if (size < 1024) return `${String(size)} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

/* Inline "new file / new folder" editor row: Enter commits, Escape or blur
   cancels. Replaces the prompt dialog for creation — the row sits at the
   top of the target directory and edits in place (VS Code explorer style). */
function InlineCreateRow({ kind, depth, placeholder, onCommit, onCancel }: {
  kind: 'file' | 'directory'
  depth: number
  placeholder: string
  onCommit(name: string): Promise<void>
  onCancel(): void
}): JSX.Element {
  const [value, setValue] = useState('')
  const commit = (): void => {
    if (value.trim() === '') {
      onCancel()
      return
    }
    void onCommit(value)
  }
  return (
    <ListRow className={`dsh-studio-files-inline-create`} data-kind={kind}>
      <ListRowLeading aria-hidden="true">
        {kind === 'directory' ? <IconFolderPlus size={14} /> : <IconFilePlus size={14} />}
      </ListRowLeading>
      <div
        className={surfaceCss["dsh-studio-files-inline-main"]}
        style={{ '--tree-depth': depth } as CSSProperties}
      >
        <Input
          autoFocus
          className={surfaceCss["dsh-studio-files-inline-input"]}
          placeholder={placeholder}
          aria-label={placeholder}
          value={value}
          onChange={event => { setValue(event.currentTarget.value) }}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              onCancel()
            }
          }}
          onBlur={onCancel}
        />
      </div>
    </ListRow>
  )
}

export type InlineCreatePending = { parent: string; kind: 'file' | 'directory' }

export interface FilesTreeProps {
  cwd: string
  scopeKey: string
  t: Translate<WorkspaceMessage>
  rows: FileRow[]
  loading: boolean
  error: string
  inlineCreate: InlineCreatePending | null
  onCommitInlineCreate(name: string): Promise<void>
  onCancelInlineCreate(): void
  onToggleDirectory(directory: string): Promise<void>
  onOpenFile(path: string, name: string, intent: OpenIntent): void
  onBeginInlineCreate(kind: 'file' | 'directory', parent: string): Promise<void>
  refreshListings(affectedPath?: string): void
  renameFsEntry(target?: string | null): Promise<void>
  copyFsEntry(target?: string | null): Promise<void>
  deleteFsEntry(target?: string | null): Promise<void>
}

type RowMenuState = {
  x: number
  y: number
  path: string
  name: string
  kind: 'file' | 'directory'
} | null

/** The explorer row stream + its popup state. */
export function FilesTree({
  cwd,
  scopeKey,
  t,
  rows,
  loading,
  error,
  inlineCreate,
  onCommitInlineCreate,
  onCancelInlineCreate,
  onToggleDirectory,
  onOpenFile,
  onBeginInlineCreate,
  refreshListings,
  renameFsEntry,
  copyFsEntry,
  deleteFsEntry,
}: FilesTreeProps): JSX.Element {
  const [rowMenu, setRowMenu] = useState<RowMenuState>(null)
  const [backgroundMenu, setBackgroundMenu] = useState<{ x: number; y: number } | null>(null)

  // Inline create: the editor row is spliced into the row stream right after
  // its parent directory row (or at the top for the workspace root).
  const displayItems: Array<
    { kind: 'row'; row: FileRow } | { kind: 'inline'; entryKind: 'file' | 'directory'; depth: number }
  > = []
  if (inlineCreate !== null && inlineCreate.parent === cwd && rows.length === 0) {
    displayItems.push({ kind: 'inline', entryKind: inlineCreate.kind, depth: 0 })
  }
  rows.forEach((row, index) => {
    if (inlineCreate !== null && inlineCreate.parent === cwd && index === 0) {
      displayItems.push({ kind: 'inline', entryKind: inlineCreate.kind, depth: 0 })
    }
    displayItems.push({ kind: 'row', row })
    if (inlineCreate !== null && row.path === inlineCreate.parent) {
      displayItems.push({ kind: 'inline', entryKind: inlineCreate.kind, depth: row.depth + 1 })
    }
  })
  const isEmpty = !loading && !error && rows.length === 0 && inlineCreate === null

  // Row context menu: right-click anywhere on a row, or the hover ⋯ button.
  // File rows also become the selected entry so the header menu follows.
  // Symlink rows behave like files here (fs ops operate on the link itself).
  const openRowMenuAt = (x: number, y: number, row: FileRow): void => {
    const kind = row.kind === 'directory' ? 'directory' : 'file'
    if (kind === 'file') {
      useSidebarChromeStore.getState().setExplorerSelectedPath(scopeKey, row.path)
    }
    setRowMenu({ x, y, path: row.path, name: row.name, kind })
  }

  const openRowMenu = (event: ReactMouseEvent, row: FileRow): void => {
    event.preventDefault()
    event.stopPropagation()
    openRowMenuAt(event.clientX, event.clientY, row)
  }

  const openRowMenuFromButton = (event: ReactMouseEvent<HTMLButtonElement>, row: FileRow): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    openRowMenuAt(rect.left, rect.bottom + 4, row)
  }

  // Directory rows create inside the directory; fs.copy is file-only
  // (host copyFile), so copy is offered for files only.
  const rowMenuItems: MenuEntry[] = rowMenu === null ? [] : (
    rowMenu.kind === 'file'
      ? [
        { id: 'open', label: t('files.open'), icon: <IconEye size={14} /> },
        { type: 'separator', id: 'row-sep-1' },
        { id: 'rename', label: t('files.rename'), icon: <IconEdit size={14} /> },
        { id: 'copy', label: t('files.copy'), icon: <IconCopy size={14} /> },
        { type: 'separator', id: 'row-sep-2' },
        { id: 'delete', label: t('files.delete'), icon: <IconTrash size={14} />, danger: true },
      ]
      : [
        { id: 'new-file', label: t('files.new-file'), icon: <IconFilePlus size={14} /> },
        { id: 'new-folder', label: t('files.new-folder'), icon: <IconFolderPlus size={14} /> },
        { type: 'separator', id: 'row-sep-1' },
        { id: 'rename', label: t('files.rename'), icon: <IconEdit size={14} /> },
        { type: 'separator', id: 'row-sep-2' },
        { id: 'delete', label: t('files.delete'), icon: <IconTrash size={14} />, danger: true },
      ]
  )

  const handleRowMenuSelect = (id: string): void => {
    const menu = rowMenu
    setRowMenu(null)
    if (menu === null) return
    switch (id) {
      case 'open':
        onOpenFile(menu.path, menu.name, 'pin')
        break
      case 'new-file':
        void onBeginInlineCreate('file', menu.path)
        break
      case 'new-folder':
        void onBeginInlineCreate('directory', menu.path)
        break
      case 'rename':
        void renameFsEntry(menu.path)
        break
      case 'copy':
        void copyFsEntry(menu.path)
        break
      case 'delete':
        void deleteFsEntry(menu.path)
        break
      default:
        break
    }
  }

  // Empty-area context menu: create in the workspace root or refresh.
  const openBackgroundMenu = (event: ReactMouseEvent): void => {
    event.preventDefault()
    setBackgroundMenu({ x: event.clientX, y: event.clientY })
  }

  const backgroundMenuItems: MenuEntry[] = [
    { id: 'new-file', label: t('files.new-file'), icon: <IconFilePlus size={14} /> },
    { id: 'new-folder', label: t('files.new-folder'), icon: <IconFolderPlus size={14} /> },
    { type: 'separator', id: 'bg-sep' },
    { id: 'refresh', label: t('files.refresh'), icon: <IconRefresh size={14} /> },
  ]

  const handleBackgroundMenuSelect = (id: string): void => {
    setBackgroundMenu(null)
    if (id === 'refresh') {
      refreshListings()
      return
    }
    void onBeginInlineCreate(id === 'new-file' ? 'file' : 'directory', cwd)
  }

  return (
    <>
      {loading && !rows.length && <LoadingState label={t('files.loading')} />}
      {error !== '' && <ErrorState message={error} />}
      <ScrollArea
        className={surfaceCss["dsh-studio-file-list"]}
        viewportClassName="dsh-studio-ui-scroll-viewport-inset"
        onContextMenu={openBackgroundMenu}
      >
        {displayItems.map(item => (
          item.kind === 'inline' ? (
            <InlineCreateRow
              key="dsh-studio-inline-create"
              kind={item.entryKind}
              depth={item.depth}
              placeholder={item.entryKind === 'directory' ? t('files.new-folder') : t('files.new-file')}
              onCommit={onCommitInlineCreate}
              onCancel={onCancelInlineCreate}
            />
          ) : (
            <ListRow
              key={item.row.key}
              selected={item.row.selected}
              title={item.row.path}
              data-path={item.row.path}
              onContextMenu={event => { openRowMenu(event, item.row) }}
            >
              <ListRowMain
                className={surfaceCss["dsh-studio-files-depth-main"]}
                style={{ '--tree-depth': item.row.depth } as CSSProperties}
                aria-expanded={item.row.kind === 'directory' ? item.row.expanded : undefined}
                onClick={() => {
                  if (item.row.kind === 'directory') {
                    void onToggleDirectory(item.row.path)
                  } else {
                    // Select the file (drives rename/copy/delete) and preview
                    // it in the center; double click pins the tab.
                    if (scopeKey !== null) {
                      useSidebarChromeStore.getState().setExplorerSelectedPath(scopeKey, item.row.path)
                    }
                    onOpenFile(item.row.path, item.row.name, 'preview')
                  }
                }}
                onDoubleClick={() => {
                  if (item.row.kind !== 'directory') {
                    onOpenFile(item.row.path, item.row.name, 'pin')
                  }
                }}
              >
                <ListRowLeading aria-hidden="true">
                  {item.row.kind === 'directory'
                    ? item.row.expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />
                    : null}
                </ListRowLeading>
                <FileGlyph path={item.row.path} kind={item.row.kind} expanded={item.row.expanded} />
                <ListRowBody>
                  <FilenameLabel name={item.row.name} title={item.row.path} />
                </ListRowBody>
              </ListRowMain>
              {item.row.kind !== 'directory' && (
                <ListRowTrailing>
                  <span className={surfaceCss["dsh-studio-files-size"]}>{formatSize(item.row.size)}</span>
                </ListRowTrailing>
              )}
              <ListRowActions>
                <ListRowActionButton
                  type="button"
                  aria-label={t('files.more-actions')}
                  title={t('files.more-actions')}
                  data-popup-open={rowMenu?.path === item.row.path ? '' : undefined}
                  onClick={event => { openRowMenuFromButton(event, item.row) }}
                ><IconDots size={14} /></ListRowActionButton>
              </ListRowActions>
            </ListRow>
          )
        ))}
        {isEmpty && <EmptyState title={t('files.empty-directory')} />}
      </ScrollArea>
      <Menu
        open={rowMenu !== null}
        anchor={null}
        portal
        getAnchorRect={() => rowMenu === null ? null : new DOMRect(rowMenu.x, rowMenu.y, 0, 0)}
        items={rowMenuItems}
        onSelect={handleRowMenuSelect}
        onClose={() => { setRowMenu(null) }}
      />
      <Menu
        open={backgroundMenu !== null}
        anchor={null}
        portal
        getAnchorRect={() => backgroundMenu === null ? null : new DOMRect(backgroundMenu.x, backgroundMenu.y, 0, 0)}
        items={backgroundMenuItems}
        onSelect={handleBackgroundMenuSelect}
        onClose={() => { setBackgroundMenu(null) }}
      />
    </>
  )
}