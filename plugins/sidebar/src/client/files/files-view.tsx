/**
 * The files surfaces of the desktop side panel (B1 split): `FilesView` is
 * the workspace explorer tree + search + inline create/rename/copy/delete;
 * `FileView` is the single-file viewer host that matches a registered
 * viewer. Extracted verbatim from SideToolsPanel.tsx — behavior unchanged.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { Input, Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@dsh-studio/shared/i18n'
import {
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconDots,
  IconEdit,
  IconEye,
  IconFilePlus,
  IconFolderPlus,
  IconPlus,
  IconRefresh,
  IconTrash,
} from '@dsh-studio/shared/tabler-icons'
import {
  basename,
  dirname,
  isUnderRoot,
  joinPath,
  relativePathOf,
  resolveCapabilitiesPath,
} from '@dsh-studio/shared/path'
import { EmptyState, ErrorState, LoadingState, ToolbarAction, useMenuAnchor } from '@dsh-studio/shared/ui'
import {
  ListRow,
  ListRowActionButton,
  ListRowActions,
  ListRowBody,
  ListRowLeading,
  ListRowMain,
  ListRowTrailing,
} from '@dsh-studio/shared/ui'
import { FilenameLabel } from '@dsh-studio/shared/filename-label'
import { ScrollArea } from '@dsh-studio/shared/ui'
import { FileGlyph } from '@dsh-studio/shared/tabler-icons'
import type {
  WorkspaceFileEntry,
  WorkspaceFilesResponse,
} from '../../protocol.ts'
import { sidebarApi, mapSidebarFile } from '../sidebar-api.ts'
import { buildFileRows, type FileRow } from './file-tree-model.ts'
import { getExplorerRuntime, sidebarScopeKey } from '../runtimes/registry.ts'
import { useSidebarChromeStore } from '../runtimes/chrome-store.ts'
import { openFileSurface } from '../open/pipeline.ts'
import type { OpenIntent } from '@dsh-studio/shared/workbench-contracts'
import { alertDialog, confirmDialog, promptDialog } from '../kit/dialog.tsx'
import type {
  DesktopSidebarService,
  SidebarRenderProps,
} from '../contract.ts'
import type { ReviewCommentsService } from '../review/review-comments.ts'
import type { WorkspaceMessage } from '../i18n.ts'

/** File-search debounce (ms) before hitting the runtime. */
const SEARCH_DEBOUNCE_MS = 250
/** File search result rows shown per query. */
const SEARCH_RESULT_LIMIT = 100
/** Bytes sniffed from a file head for viewer detection. */
const VIEWER_SNIFF_BYTES = 512

function formatSize(size: number | null): string {
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
    <ListRow className="dsh-studio-files-inline-create" data-kind={kind}>
      <ListRowLeading aria-hidden="true">
        {kind === 'directory' ? <IconFolderPlus size={14} /> : <IconFilePlus size={14} />}
      </ListRowLeading>
      <div
        className="dsh-studio-files-inline-main"
        style={{ '--tree-depth': depth } as CSSProperties}
      >
        <Input
          autoFocus
          className="dsh-studio-files-inline-input"
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

export function FilesView({
  active,
  patch,
  scope,
  sidebar,
  t,
  tab,
}: SidebarRenderProps & {
  sidebar: DesktopSidebarService
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const cwd = scope?.cwd
  // Retained explorer runtime: switching tabs back hits the cached listings
  // (zero network), because the registry keeps the instance alive.
  const runtime = useMemo(
    () => (scope === null || scope.cwd === undefined
      ? null
      : getExplorerRuntime({ cwd: scope.cwd })),
    [scope?.cwd],
  )
  const listingsFingerprint = useSyncExternalStore(
    useCallback((listener: () => void) => runtime?.subscribe(listener) ?? (() => {}), [runtime]),
    useCallback(() => runtime?.listingsFingerprint() ?? 'none', [runtime]),
  )
  const scopeKey = scope === null || scope.cwd === undefined
    ? null
    : sidebarScopeKey({ cwd: scope.cwd })
  const chrome = useSidebarChromeStore(state =>
    scopeKey === null ? null : state.getSlice(scopeKey))
  const expandedDirs = useMemo(
    () => new Set(chrome?.explorer.expandedPaths ?? []),
    [chrome?.explorer.expandedPaths],
  )
  const selectedPath = chrome?.explorer.selectedPath ?? null
  const [searchQuery, setSearchQuery] = useState('')
  const [searchHits, setSearchHits] = useState<Array<{ path: string; line: number; text: string }> | null>(null)
  const [searching, setSearching] = useState(false)
  // Header [+] dropdown (official Menu, portaled; the trigger button keeps
  // aria-expanded so the CSS can show the pressed state).
  const {
    open: createMenuOpen,
    setOpen: setCreateMenuOpen,
    anchorRef: createButtonRef,
    getAnchorRect,
  } = useMenuAnchor()
  // Inline create editor row state (parent directory + entry kind).
  const [inlineCreate, setInlineCreate] = useState<{
    parent: string
    kind: 'file' | 'directory'
  } | null>(null)
  // Row / background context menus (right-click, or the row hover ⋯).
  const [rowMenu, setRowMenu] = useState<{
    x: number
    y: number
    path: string
    name: string
    kind: 'file' | 'directory'
  } | null>(null)
  const [backgroundMenu, setBackgroundMenu] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (scope == null || cwd === undefined) return
    if (searchQuery.trim() === '') {
      setSearchHits(null)
      setSearching(false)
      return
    }
    const controller = new AbortController()
    setSearching(true)
    const timer = window.setTimeout(() => {
      void sidebarApi.fsSearch(scope, searchQuery, false, controller.signal).then(hits => {
        setSearchHits(hits)
        setSearching(false)
      }).catch(() => {
        setSearchHits([])
        setSearching(false)
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [cwd, scope, searchQuery])

  // Tree mode expands from the workspace root; ensureListing short-circuits
  // on Ready/Empty — revisiting after a tab switch costs zero network.
  useEffect(() => {
    if (runtime === null || cwd === undefined) return
    void runtime.ensureListing(null)
  }, [cwd, runtime])

  // Drop cached listings (root + expanded dirs) and reload them — the
  // refresh button and every fs mutation share this path, because
  // ensureListing alone short-circuits on cached Ready listings.
  const refreshListings = useCallback((): void => {
    if (runtime === null) return
    const keys = [...runtime.getListingsSnapshot().keys()]
    void Promise.all(keys.map(key => runtime.refresh(key)))
  }, [runtime])

  const ensureLoaded = useCallback(async (directory: string): Promise<boolean> => {
    if (runtime === null || cwd === undefined) return false
    const relative = directory === cwd ? '' : relativePathOf(cwd, directory)
    const listing = runtime.getListing(relative)
    if (listing !== undefined
      && (listing.phase === 'ready' || listing.phase === 'empty')) {
      return true
    }
    try {
      await runtime.ensureListing(relative)
      return true
    } catch {
      return false
    }
  }, [cwd, runtime])

  const toggleDirectory = async (directory: string): Promise<void> => {
    if (scopeKey === null) return
    // Expand-on-click (no drill-down navigation): load the children lazily
    // on first expansion, then toggle the chrome-store expansion state.
    if (!expandedDirs.has(directory) && !entriesByDir.has(directory)) {
      await ensureLoaded(directory)
    }
    useSidebarChromeStore.getState().toggleExplorerDirectory(scopeKey, directory)
  }

  // Directory listings derived from the runtime cache (the cache is the
  // fact source; the view never fetches).
  const entriesByDir: ReadonlyMap<string, readonly WorkspaceFileEntry[]> = useMemo(() => {
    if (runtime === null || cwd === undefined) return new Map()
    const map = new Map<string, readonly WorkspaceFileEntry[]>()
    for (const [dir, listing] of runtime.getListingsSnapshot()) {
      if (listing.phase !== 'ready' && listing.phase !== 'empty') continue
      map.set(resolveCapabilitiesPath(cwd, dir), listing.entries.map(entry => ({
        kind: entry.isDirectory ? 'directory' : 'file',
        name: entry.name,
        path: entry.path,
        size: null,
      })))
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fingerprint is the revision
  }, [cwd, listingsFingerprint, runtime])

  const rootListing = runtime === null || cwd === undefined ? undefined : runtime.getListing('')
  const loading = rootListing?.phase === 'loading'
  const error = rootListing?.phase === 'error' ? (rootListing.message ?? '') : ''

  const rows = buildFileRows({
    currentPath: cwd ?? '',
    entriesByDir,
    expandedDirs,
    selectedPath,
  })

  const openFileInCenter = (filePath: string, name: string, intent: OpenIntent): void => {
    if (cwd === undefined) return
    // Single click = preview intent (a replaceable tab under `default`,
    // permanent when previews are disabled); double click / explicit open =
    // pin. The pipeline owns the mapping — see client/open/pipeline.ts.
    openFileSurface({ cwd, filePath, title: name, intent })
  }

  // Inline creation: open an editor row at the top of `parent` (expanding the
  // directory first when it is collapsed) instead of asking through a dialog.
  const beginInlineCreate = async (kind: 'file' | 'directory', parent: string): Promise<void> => {
    if (cwd === undefined || scope == null) return
    setSearchQuery('')
    setInlineCreate(null)
    if (parent !== cwd && !expandedDirs.has(parent)) {
      if (!entriesByDir.has(parent)) {
        const loaded = await ensureLoaded(parent)
        if (!loaded) return
      }
      if (scopeKey !== null) {
        useSidebarChromeStore.getState().toggleExplorerDirectory(scopeKey, parent)
      }
    }
    setInlineCreate({ parent, kind })
  }

  const commitInlineCreate = async (name: string): Promise<void> => {
    const pending = inlineCreate
    if (pending === null || cwd === undefined || scope == null) return
    const trimmed = name.trim()
    if (trimmed === '') {
      setInlineCreate(null)
      return
    }
    try {
      await sidebarApi.fsCreate(scope, joinPath(pending.parent, trimmed), pending.kind === 'directory')
      setInlineCreate(null)
      refreshListings()
    } catch (cause) {
      setInlineCreate(null)
      await alertDialog({
        title: t('files.op-failed'),
        message: cause instanceof Error ? cause.message : String(cause),
        confirmLabel: t('dialog.ok'),
      })
    }
  }

  const cancelInlineCreate = (): void => {
    setInlineCreate(null)
  }

  const renameFsEntry = async (target: string | null = selectedPath): Promise<void> => {
    if (cwd === undefined || scope == null || target === null) return
    const name = await promptDialog({
      title: t('files.rename-to'),
      defaultValue: basename(target),
      confirmLabel: t('dialog.ok'),
      cancelLabel: t('dialog.cancel'),
    })
    if (name === null || name.trim() === '') return
    const parent = dirname(target) || cwd
    try {
      await sidebarApi.fsRename(scope, target, joinPath(parent, name.trim()))
      refreshListings()
    } catch (cause) {
      await alertDialog({
        title: t('files.op-failed'),
        message: cause instanceof Error ? cause.message : String(cause),
        confirmLabel: t('dialog.ok'),
      })
    }
  }

  const deleteFsEntry = async (target: string | null = selectedPath): Promise<void> => {
    if (cwd === undefined || scope == null || target === null) return
    const confirmed = await confirmDialog({
      title: t('files.delete'),
      message: t('files.delete-confirm', { path: target }),
      confirmLabel: t('files.delete'),
      cancelLabel: t('dialog.cancel'),
      danger: true,
    })
    if (!confirmed) return
    try {
      await sidebarApi.fsDelete(scope, target)
      refreshListings()
    } catch (cause) {
      await alertDialog({
        title: t('files.op-failed'),
        message: cause instanceof Error ? cause.message : String(cause),
        confirmLabel: t('dialog.ok'),
      })
    }
  }

  const copyFsEntry = async (target: string | null = selectedPath): Promise<void> => {
    if (cwd === undefined || scope == null || target === null) return
    const base = basename(target)
    const name = await promptDialog({
      title: t('files.copy-to'),
      defaultValue: `${base}.copy`,
      confirmLabel: t('dialog.ok'),
      cancelLabel: t('dialog.cancel'),
    })
    if (name === null || name.trim() === '') return
    try {
      await sidebarApi.fsCopy(scope, target, joinPath(dirname(target) || cwd, name.trim()))
      refreshListings()
    } catch (cause) {
      await alertDialog({
        title: t('files.op-failed'),
        message: cause instanceof Error ? cause.message : String(cause),
        confirmLabel: t('dialog.ok'),
      })
    }
  }

  // Explorer keyboard shortcuts while the files tab is the active panel:
  // F2 renames the selected entry, Delete removes it (after confirmation).
  // Ignored while a menu or dialog is open, or when a text field is focused.
  useEffect(() => {
    if (!active || cwd === undefined || scope == null) return
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target
      if (target instanceof HTMLElement
        && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
          || target.tagName === 'SELECT' || target.isContentEditable)) {
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (document.querySelector('[role="menu"], [role="dialog"]') !== null) return
      if (event.key === 'F2' && selectedPath !== null) {
        event.preventDefault()
        void renameFsEntry(selectedPath)
      } else if (event.key === 'Delete' && selectedPath !== null) {
        event.preventDefault()
        void deleteFsEntry(selectedPath)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  })

  // Row context menu: right-click anywhere on a row, or the hover ⋯ button.
  // File rows also become the selected entry so the header menu follows.
  // Symlink rows behave like files here (fs ops operate on the link itself).
  const openRowMenu = (event: ReactMouseEvent, row: FileRow): void => {
    event.preventDefault()
    event.stopPropagation()
    const kind = row.kind === 'directory' ? 'directory' : 'file'
    if (kind === 'file' && scopeKey !== null) {
      useSidebarChromeStore.getState().setExplorerSelectedPath(scopeKey, row.path)
    }
    setRowMenu({ x: event.clientX, y: event.clientY, path: row.path, name: row.name, kind })
  }

  const openRowMenuFromButton = (event: ReactMouseEvent<HTMLButtonElement>, row: FileRow): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    const kind = row.kind === 'directory' ? 'directory' : 'file'
    if (kind === 'file' && scopeKey !== null) {
      useSidebarChromeStore.getState().setExplorerSelectedPath(scopeKey, row.path)
    }
    setRowMenu({ x: rect.left, y: rect.bottom + 4, path: row.path, name: row.name, kind })
  }

  // Empty-area context menu: create in the workspace root or refresh.
  const openBackgroundMenu = (event: ReactMouseEvent): void => {
    event.preventDefault()
    setBackgroundMenu({ x: event.clientX, y: event.clientY })
  }

  const createMenuItems: MenuEntry[] = [
    { id: 'new-file', label: t('files.new-file'), icon: <IconFilePlus size={14} /> },
    { id: 'new-folder', label: t('files.new-folder'), icon: <IconFolderPlus size={14} /> },
  ]

  const handleCreateMenuSelect = (id: string): void => {
    setCreateMenuOpen(false)
    if (cwd === undefined) return
    void beginInlineCreate(id === 'new-file' ? 'file' : 'directory', cwd)
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
        openFileInCenter(menu.path, menu.name, 'pin')
        break
      case 'new-file':
        void beginInlineCreate('file', menu.path)
        break
      case 'new-folder':
        void beginInlineCreate('directory', menu.path)
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
    if (cwd === undefined) return
    void beginInlineCreate(id === 'new-file' ? 'file' : 'directory', cwd)
  }

  // The inline create editor row is spliced into the row stream right after
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

  if (cwd === undefined) {
    return <EmptyState className="dsh-studio-side-empty" title={t('files.select-workspace')} />
  }
  return (
    <div className="dsh-studio-files-view">
      <div className="dsh-studio-files-path" title={cwd}>
        <span className="dsh-studio-files-path-name">{basename(cwd)}</span>
        <ToolbarAction
          ref={createButtonRef}
          variant="ghost"
          icon={<IconPlus size={14} />}
          label={t('files.new')}
          aria-expanded={createMenuOpen}
          pressed={createMenuOpen}
          onClick={() => { setCreateMenuOpen(value => !value) }}
        />
        <ToolbarAction
          variant="ghost"
          icon={<IconRefresh size={14} />}
          label={t('files.refresh')}
          onClick={refreshListings}
        />
      </div>
      {/* Portaled menu — kept OUTSIDE the flex row: the official Menu always
          renders an anchor wrapper span, and a bare `span` selector on the
          path bar would hand that empty wrapper flex:1, pushing the buttons
          off the right edge. Portal mode positions from the button rect, so
          placement is unaffected. */}
      <Menu
        open={createMenuOpen}
        anchor={null}
        align="end"
        portal
        getAnchorRect={getAnchorRect}
        items={createMenuItems}
        onSelect={handleCreateMenuSelect}
        onClose={() => { setCreateMenuOpen(false) }}
      />
      <div className="dsh-studio-files-search">
        <input
          type="search"
          placeholder={t('files.search-placeholder')}
          value={searchQuery}
          onChange={event => { setSearchQuery(event.target.value) }}
          onKeyDown={event => {
            if (event.key === 'Escape') setSearchQuery('')
          }}
        />
      </div>
      {searchHits !== null ? (
        <ScrollArea className="dsh-studio-file-search-results" viewportClassName="dsh-studio-ui-scroll-viewport-inset">
          {searching ? <LoadingState label={t('files.loading')} /> : null}
          {!searching && searchHits.length === 0 ? (
            <EmptyState title={t('files.search-no-matches')} />
          ) : null}
          {searchHits.slice(0, SEARCH_RESULT_LIMIT).map(hit => (
            <button
              key={`${hit.path}:${hit.line}`}
              type="button"
              className="dsh-studio-file-search-hit"
              onClick={() => {
                const cwd2 = cwd
                if (cwd2 === undefined) return
                const abs = isUnderRoot(cwd2, hit.path) ? hit.path : joinPath(cwd2, hit.path)
                openFileSurface({
                  cwd: cwd2,
                  filePath: abs,
                  title: basename(hit.path),
                  intent: 'preview',
                })
              }}
            >
              <span className="dsh-studio-file-search-hit-path">{hit.path}:{hit.line}</span>
              <span className="dsh-studio-file-search-hit-text">{hit.text}</span>
            </button>
          ))}
        </ScrollArea>
      ) : null}
      {loading && !entriesByDir.has(cwd) && <LoadingState label={t('files.loading')} />}
      {error !== '' && <ErrorState message={error} />}
      <ScrollArea className="dsh-studio-file-list" viewportClassName="dsh-studio-ui-scroll-viewport-inset" onContextMenu={openBackgroundMenu}>
        {displayItems.map(item => (
          item.kind === 'inline' ? (
            <InlineCreateRow
              key="dsh-studio-inline-create"
              kind={item.entryKind}
              depth={item.depth}
              placeholder={item.entryKind === 'directory' ? t('files.new-folder') : t('files.new-file')}
              onCommit={commitInlineCreate}
              onCancel={cancelInlineCreate}
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
                className="dsh-studio-files-depth-main"
                style={{ '--tree-depth': item.row.depth } as CSSProperties}
                aria-expanded={item.row.kind === 'directory' ? item.row.expanded : undefined}
                onClick={() => {
                  if (item.row.kind === 'directory') {
                    void toggleDirectory(item.row.path)
                  } else {
                    // Select the file (drives rename/copy/delete) and preview
                    // it in the center; double click pins the tab.
                    if (scopeKey !== null) {
                      useSidebarChromeStore.getState().setExplorerSelectedPath(scopeKey, item.row.path)
                    }
                    openFileInCenter(item.row.path, item.row.name, 'preview')
                  }
                }}
                onDoubleClick={() => {
                  if (item.row.kind !== 'directory') {
                    openFileInCenter(item.row.path, item.row.name, 'pin')
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
                  <span className="dsh-studio-files-size">{formatSize(item.row.size)}</span>
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
        {!loading && !error && rows.length === 0 && inlineCreate === null && (
          <EmptyState title={t('files.empty-directory')} />
        )}
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
    </div>
  )
}

export function FileView({
  onOpenPath,
  reviewComments,
  scope,
  sidebar,
  t,
  tab,
}: SidebarRenderProps & {
  onOpenPath(path: string): Promise<void>
  reviewComments: ReviewCommentsService
  sidebar: DesktopSidebarService
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const cwd = scope?.cwd
  const [snapshot, setSnapshot] = useState<WorkspaceFilesResponse | null>(null)
  const [error, setError] = useState('')
  const path = tab.resource

  useEffect(() => {
    if (cwd === undefined || path === undefined || scope == null) return
    const controller = new AbortController()
    void sidebarApi.fsRead(scope, path, controller.signal).then(
      result => {
        setSnapshot(mapSidebarFile(cwd, path, result))
        setError('')
      },
    ).catch((next: unknown) => {
      if (!controller.signal.aborted) {
        setError(next instanceof Error ? next.message : String(next))
      }
    })
    return () => { controller.abort() }
  }, [cwd, path, scope])

  if (cwd === undefined || path === undefined) {
    return <EmptyState className="dsh-studio-side-empty" title={t('files.select-workspace')} />
  }
  if (error !== '') return <ErrorState message={error} />
  if (snapshot === null) return <LoadingState label={t('files.loading')} />
  if (snapshot.kind !== 'file') {
    return <EmptyState title={t('files.not-file')} />
  }
  const head = snapshot.binary
    ? new Uint8Array([0])
    : new TextEncoder().encode((snapshot.content ?? '').slice(0, VIEWER_SNIFF_BYTES))
  const viewer = sidebar.matchViewer(path, head)
  if (viewer?.render !== undefined) {
    return <>{viewer.render({
      ...(snapshot.content !== null ? { content: snapshot.content } : {}),
      path,
      title: tab.title,
      // The viewer needs the session scope for cwd-relative payloads
      // (the "add to conversation" selection popup).
      ...(scope === null || scope === undefined ? {} : { scope }),
    })}</>
  }
  return (
    <ScrollArea className="dsh-studio-file-preview" viewportClassName="dsh-studio-ui-scroll-viewport-inset">
      <div>
        <strong>{tab.title}</strong>
        <button type="button" onClick={() => { void onOpenPath(path) }}>
          {t('files.open')}
        </button>
      </div>
      <EmptyState title={t('files.no-viewer', { size: formatSize(snapshot.size) })} />
    </ScrollArea>
  )
}
