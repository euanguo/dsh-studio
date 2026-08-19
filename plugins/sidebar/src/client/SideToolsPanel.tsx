import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import {
  Input,
  Menu,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@oh-dsh/shared/i18n'
import type { DesktopPanels } from '@oh-dsh/panel-controls/client'
import { IconRestore } from '@oh-dsh/shared/icons'
import {
  FileGlyph,
  IconChevronDown,
  IconChevronRight,
  IconClose,
  IconCopy,
  IconDots,
  IconEdit,
  IconEye,
  IconFilePlus,
  IconFolderOpen,
  IconFolderPlus,
  IconGitBranch,
  IconList,
  IconMaximize,
  IconMessagePlus,
  IconMinus,
  IconPlus,
  IconRefresh,
  IconSidebarRightFilled,
  IconTerminal,
  IconTrash,
  IconWorld,
} from '@oh-dsh/shared/tabler-icons'
import {
  basename,
  dirname,
  isUnderRoot,
  joinPath,
  relativePathOf,
  resolveSidebarPath,
} from '@oh-dsh/shared/path'
import type { WorkspaceFilesResponse, WorkspaceFileEntry, WorkspaceFileKind } from '../protocol.ts'
import { EmptyView, ErrorView, LoadingView } from './kit/status.tsx'
import {
  sidebarApi,
  mapSidebarFile,
} from './sidebar-api.ts'
import { buildFileRows, type FileRow } from './files/file-tree-model.ts'
import {
  ListRow,
  ListRowActionButton,
  ListRowActions,
  ListRowBody,
  ListRowLeading,
  ListRowMain,
  ListRowTrailing,
} from '@oh-dsh/shared/list-row'
import { FilenameLabel } from '@oh-dsh/shared/filename-label'
import { SurfaceTab } from '@oh-dsh/shared/surface-tab'
import { bindTabStripWheel } from '@oh-dsh/shared/tab-strip-wheel'
import { useTabStripDrag } from './use-tab-strip-drag.ts'
import { Scrollable } from '@oh-dsh/shared/scrollable'
import {
  getExplorerRuntime,
  sidebarScopeKey,
} from './runtimes/registry.ts'
import { useSidebarChromeStore } from './runtimes/chrome-store.ts'
import { useCenterSurfaceStore } from './surfaces/center-surface-store.ts'
import { binding, formatKeymapHint } from './kit/keymap.ts'
import { alertDialog, confirmDialog, promptDialog } from './kit/dialog.tsx'
import type {
  DesktopSidebarService,
  SidebarRenderProps,
  SidebarScope,
  SidebarTab,
  SidebarTabAvailability,
  SidebarTabDescriptor,
} from './contract.ts'
import { tabAvailability } from './contract.ts'
import type { ReviewCommentsService } from './review/review-comments.ts'
import type { WorkspaceMessage } from './i18n.ts'

/** Tab descriptor icon size (px). */
const DESCRIPTOR_ICON_SIZE = 21
/** File search debounce (ms) before hitting the runtime. */
const SEARCH_DEBOUNCE_MS = 250
/** File search result rows shown per query. */
const SEARCH_RESULT_LIMIT = 100
/** Bytes sniffed from a file head for viewer detection. */
const VIEWER_SNIFF_BYTES = 512

interface SideToolsPanelProps {
  cwd: string | undefined
  maximized: boolean
  onClose(): void
  /** Live drag preview: fired at most once per frame (rAF-coalesced). */
  onResizePreview(width: number): void
  /** Final width commit; fired once on pointerup / pointercancel. */
  onResize(width: number): void
  onToggleMaximized(): void
  onToggleSide(): void
  open: boolean
  panels: DesktopPanels
  sidebar: DesktopSidebarService
  t: Translate<WorkspaceMessage>
  width: number
}

// The glyph set lives in the shared kit (both the generic rail and the
// desktop add-on render descriptor icons); re-exported here for the
// panel-internal call sites.
export { ToolIcon, type ToolIconKind } from '@oh-dsh/shared/tool-icon'
import { ToolIcon, type ToolIconKind } from '@oh-dsh/shared/tool-icon'

function defaultIcon(id: string): ToolIconKind {
  if (id === 'review' || id === 'terminal' || id === 'browser'
    || id === 'files' || id === 'trajectory' || id === 'subagent') return id
  if (id === 'side-chat') return 'chat'
  return 'file'
}

function descriptorTitle(descriptor: SidebarTabDescriptor): string {
  return typeof descriptor.title === 'function'
    ? descriptor.title()
    : descriptor.title
}

function DescriptorIcon({ descriptor }: {
  descriptor: SidebarTabDescriptor
}): JSX.Element {
  const icon = typeof descriptor.icon === 'function'
    ? descriptor.icon(DESCRIPTOR_ICON_SIZE)
    : descriptor.icon
  return <>{icon ?? <ToolIcon kind={defaultIcon(descriptor.id)} />}</>
}

function ToolRow(props: {
  descriptor: SidebarTabDescriptor
  disabled?: boolean
  disabledTitle?: string
  onClick(): void
}): JSX.Element {
  return (
    <button
      className="oh-dsh-side-tool-row"
      type="button"
      disabled={props.disabled}
      title={props.disabledTitle}
      aria-disabled={props.disabled || undefined}
      onClick={props.onClick}
    >
      <DescriptorIcon descriptor={props.descriptor} />
      <span>{descriptorTitle(props.descriptor)}</span>
      {props.descriptor.shortcut !== undefined && (
        <kbd>{props.descriptor.shortcut}</kbd>
      )}
    </button>
  )
}

/** Map an availability reason to its user-facing disabled hint title. */
function unavailableTitle(reason: SidebarTabAvailability, t: Translate<WorkspaceMessage>): string | undefined {
  if (reason.ok) return undefined
  if (reason.reason === 'no-workspace') return t('side.no-workspace')
  if (reason.reason === 'not-ready') return t('side.not-ready')
  return t('side.tool-disabled')
}

function SideMenu(props: SideToolsPanelProps): JSX.Element {
  const [error, setError] = useState('')
  const open = async (descriptor: SidebarTabDescriptor): Promise<void> => {
    try {
      setError('')
      if (descriptor.action !== undefined && descriptor.render === undefined) {
        await descriptor.action()
        return
      }
      const result = props.sidebar.openTab({ type: descriptor.id })
      if (result.kind === 'limit') throw new Error(props.t('side.tab-limit'))
      if (result.kind === 'disabled') throw new Error(props.t('side.tool-disabled'))
      if (result.kind === 'missing') throw new Error(props.t('side.tool-missing'))
      if (result.kind === 'not-ready') throw new Error(props.t('side.not-ready'))
    } catch (next) {
      setError(next instanceof Error ? next.message : String(next))
    }
  }
  const snapshot = props.sidebar.getSnapshot()
  const scope: SidebarScope | null = props.cwd === undefined
    ? null
    : { cwd: props.cwd }
  const descriptors = props.sidebar.getTabs().filter(descriptor =>
    descriptor.hidden !== true && props.sidebar.isTabEnabled(descriptor.id),
  )
  return (
    <Scrollable className="oh-dsh-side-menu">
      {descriptors.map(descriptor => {
        const availability = tabAvailability(descriptor, scope, snapshot, props.sidebar.isTabEnabled(descriptor.id))
        const unavailableArea = unavailableTitle(availability, props.t)
        return (
          <ToolRow
            key={descriptor.id}
            descriptor={descriptor}
            disabled={!availability.ok}
            {...(unavailableArea === undefined ? {} : { disabledTitle: unavailableArea })}
            onClick={() => { void open(descriptor) }}
          />
        )
      })}
      {error !== '' && <ErrorView message={error} />}
      <button
        type="button"
        className="oh-dsh-side-menu-close"
        aria-label={props.t('side.close')}
        onClick={props.onClose}
      ><IconClose size={16} /></button>
    </Scrollable>
  )
}

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
    <ListRow className="oh-dsh-files-inline-create" data-kind={kind}>
      <ListRowLeading aria-hidden="true">
        {kind === 'directory' ? <IconFolderPlus size={14} /> : <IconFilePlus size={14} />}
      </ListRowLeading>
      <div
        className="oh-dsh-files-inline-main"
        style={{ '--tree-depth': depth } as CSSProperties}
      >
        <Input
          autoFocus
          className="oh-dsh-files-inline-input"
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
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const createButtonRef = useRef<HTMLButtonElement | null>(null)
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
      map.set(resolveSidebarPath(cwd, dir), listing.entries.map(entry => ({
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

  const openFileInCenter = (filePath: string, name: string, preview: boolean): void => {
    if (cwd === undefined) return
    // Single click = preview tab (replaces the current preview); double
    // click / explicit open = pinned tab.
    useCenterSurfaceStore.getState().openFile({ cwd, filePath, title: name, preview })
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
        openFileInCenter(menu.path, menu.name, true)
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
    return <div className="oh-dsh-side-empty">{t('files.select-workspace')}</div>
  }
  return (
    <div className="oh-dsh-files-view">
      <div className="oh-dsh-files-path" title={cwd}>
        <span className="oh-dsh-files-path-name">{basename(cwd)}</span>
        <button
          ref={createButtonRef}
          type="button"
          aria-label={t('files.new')}
          aria-expanded={createMenuOpen}
          title={t('files.new')}
          onClick={() => { setCreateMenuOpen(value => !value) }}
        ><IconPlus size={16} /></button>
        <button
          type="button"
          aria-label={t('files.refresh')}
          title={t('files.refresh')}
          onClick={refreshListings}
        ><IconRefresh size={16} /></button>
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
        getAnchorRect={() => createButtonRef.current?.getBoundingClientRect() ?? null}
        items={createMenuItems}
        onSelect={handleCreateMenuSelect}
        onClose={() => { setCreateMenuOpen(false) }}
      />
      <div className="oh-dsh-files-search">
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
        <Scrollable className="oh-dsh-file-search-results">
          {searching ? <LoadingView label={t('files.loading')} /> : null}
          {!searching && searchHits.length === 0 ? (
            <EmptyView title={t('files.search-no-matches')} />
          ) : null}
          {searchHits.slice(0, SEARCH_RESULT_LIMIT).map(hit => (
            <button
              key={`${hit.path}:${hit.line}`}
              type="button"
              className="oh-dsh-file-search-hit"
              onClick={() => {
                const cwd2 = cwd
                if (cwd2 === undefined) return
                const abs = isUnderRoot(cwd2, hit.path) ? hit.path : joinPath(cwd2, hit.path)
                useCenterSurfaceStore.getState().openFile({
                  cwd: cwd2,
                  filePath: abs,
                  title: basename(hit.path),
                  preview: true,
                })
              }}
            >
              <span className="oh-dsh-file-search-hit-path">{hit.path}:{hit.line}</span>
              <span className="oh-dsh-file-search-hit-text">{hit.text}</span>
            </button>
          ))}
        </Scrollable>
      ) : null}
      {loading && !entriesByDir.has(cwd) && <LoadingView label={t('files.loading')} />}
      {error !== '' && <ErrorView message={error} />}
      <Scrollable className="oh-dsh-file-list" onContextMenu={openBackgroundMenu}>
        {displayItems.map(item => (
          item.kind === 'inline' ? (
            <InlineCreateRow
              key="oh-dsh-inline-create"
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
                className="oh-dsh-files-depth-main"
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
                    openFileInCenter(item.row.path, item.row.name, true)
                  }
                }}
                onDoubleClick={() => {
                  if (item.row.kind !== 'directory') {
                    openFileInCenter(item.row.path, item.row.name, false)
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
                  <span className="oh-dsh-files-size">{formatSize(item.row.size)}</span>
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
          <EmptyView title={t('files.empty-directory')} />
        )}
      </Scrollable>
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
    return <div className="oh-dsh-side-empty">{t('files.select-workspace')}</div>
  }
  if (error !== '') return <ErrorView message={error} />
  if (snapshot === null) return <LoadingView label={t('files.loading')} />
  if (snapshot.kind !== 'file') {
    return <EmptyView title={t('files.not-file')} />
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
    <Scrollable className="oh-dsh-file-preview">
      <div>
        <strong>{tab.title}</strong>
        <button type="button" onClick={() => { void onOpenPath(path) }}>
          {t('files.open')}
        </button>
      </div>
      <EmptyView title={t('files.no-viewer', { size: formatSize(snapshot.size) })} />
    </Scrollable>
  )
}

function OrphanedTab({ tab, t }: {
  tab: SidebarTab
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  return (
    <div className="oh-dsh-side-empty">
      <strong>{tab.title}</strong>
      <p>{t('side.orphaned-tab')}</p>
      <code className="oh-dsh-orphaned-type">{tab.type}</code>
    </div>
  )
}

/** The tab-strip badge of one open tab (a throwing badge is swallowed). */
function tabBadge(
  sidebar: DesktopSidebarService,
  tab: SidebarTab,
): ReactNode {
  const descriptor = sidebar.getTab(tab.type)
  if (descriptor?.badge === undefined) return null
  try {
    const value = descriptor.badge(sidebar.getSnapshot().scope, sidebar.getSnapshot())
    if (value === null || value === undefined) return null
    const label = typeof value === 'number'
      ? (value > 99 ? '99+' : String(value))
      : String(value)
    return <span className="oh-dsh-surface-tab-badge" aria-hidden="true">{label}</span>
  } catch (error) {
    console.error('[sidebar] badge error:', error)
    return null
  }
}

/* Pinned panel entries — 文件 (files) and Git (review) stay one click away,
   everything else is added through the [+] menu. Rendered with the shared
   SurfaceTab chip (the same component the center tab strip uses). Without a
   workspace cwd the workspace-bound chips (files / Git) are disabled with a
   hint — they would otherwise open an empty body. */
function PinnedTabs({ sidebar, t, cwd }: {
  sidebar: DesktopSidebarService
  t: Translate<WorkspaceMessage>
  cwd: string | undefined
}): JSX.Element {
  const snapshot = useSyncExternalStore(sidebar.subscribe, sidebar.getSnapshot)
  const activeType = snapshot.tabs.find(tab => tab.id === snapshot.activeId)?.type ?? null
  const pinnedScope: SidebarScope | null = cwd === undefined ? null : { cwd }
  const filesAvailability = tabAvailability(
    sidebar.getTab('files')!,
    pinnedScope,
    snapshot,
    sidebar.isTabEnabled('files'),
  )
  const reviewAvailability = tabAvailability(
    sidebar.getTab('review')!,
    pinnedScope,
    snapshot,
    sidebar.isTabEnabled('review'),
  )
  const openType = (type: string): void => {
    const existing = snapshot.tabs.find(tab => tab.type === type)
    if (existing !== undefined) {
      sidebar.activateTab(existing.id)
      return
    }
    sidebar.openTab({ type })
  }
  const filesTab = snapshot.tabs.find(tab => tab.type === 'files')
  const reviewTab = snapshot.tabs.find(tab => tab.type === 'review')
  const filesHint = unavailableTitle(filesAvailability, t)
  const reviewHint = unavailableTitle(reviewAvailability, t)
  return (
    <div className="oh-dsh-side-pinned" role="tablist">
      <SurfaceTab
        label={t('files')}
        icon={<ToolIcon kind="files" />}
        active={activeType === 'files'}
        disabled={!filesAvailability.ok}
        {...(filesHint === undefined ? {} : { disabledTitle: filesHint })}
        badge={filesTab === undefined ? null : tabBadge(sidebar, filesTab)}
        onSelect={() => { openType('files') }}
      />
      <SurfaceTab
        label={t('side.git')}
        icon={<ToolIcon kind="review" />}
        active={activeType === 'review'}
        disabled={!reviewAvailability.ok}
        {...(reviewHint === undefined ? {} : { disabledTitle: reviewHint })}
        badge={reviewTab === undefined ? null : tabBadge(sidebar, reviewTab)}
        onSelect={() => { openType('review') }}
      />
    </div>
  )
}

/* [+] menu rows use the official outline-16 icon set (the same set the left
   rail's picker menu uses); unknown descriptors fall back to the ellipsis. */
const TOOL_MENU_ICONS: Readonly<Record<string, ReactNode>> = {
  browser: <IconWorld />,
  files: <IconFolderOpen />,
  review: <IconGitBranch />,
  'side-chat': <IconMessagePlus />,
  terminal: <IconTerminal />,
  trajectory: <IconList />,
}

/* [+] menu: every enabled tool that is not open yet, as an anchored
   dropdown. Uses the official ui-primitives Menu in PORTAL mode: the panel
   clips absolutely-positioned children (overflow: hidden), so the list
   renders into document.body instead; the shared rule in side-tools.css
   (body > div[role='menu']) lifts it above the sidebar's fixed root. */
function AddToolsMenu({ sidebar, t }: {
  sidebar: DesktopSidebarService
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const snapshot = useSyncExternalStore(sidebar.subscribe, sidebar.getSnapshot)
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const getAnchorRect = useCallback(
    () => anchorRef.current?.getBoundingClientRect() ?? null,
    [],
  )
  const descriptors = sidebar.getTabs().filter(descriptor =>
    descriptor.hidden !== true
    && sidebar.isTabEnabled(descriptor.id)
    && !snapshot.tabs.some(tab => tab.type === descriptor.id)
  )
  const items: MenuEntry[] = descriptors.length === 0
    ? [{ type: 'label', id: 'no-more-tools', text: t('side.no-more-tools') }]
    : descriptors.map(descriptor => ({
      id: descriptor.id,
      label: descriptorTitle(descriptor),
      icon: TOOL_MENU_ICONS[descriptor.id] ?? <IconDots />,
    }))
  return (
    <div className="oh-dsh-add-tools">
      <button
        ref={anchorRef}
        type="button"
        aria-label={t('side.add-tool')}
        aria-expanded={open}
        title={t('side.add-tool')}
        onClick={() => { setOpen(value => !value) }}
      ><IconPlus size={14} /></button>
      <Menu
        open={open}
        anchor={null}
        align="end"
        items={items}
        portal
        getAnchorRect={getAnchorRect}
        onSelect={(id) => {
          sidebar.openTab({ type: id })
          setOpen(false)
        }}
        onClose={() => { setOpen(false) }}
      />
    </div>
  )
}

/* Extra open tools (beyond the pinned 文件 / Git entries) as shared
   SurfaceTab chips. The strip hosts the right-rail side of the tab drag:
   chips reorder inside the rail and can be dropped into the bottom
   workbench (or receive docked tabs back). */
const PINNED_TAB_TYPES = new Set(['files', 'review'])

function TabStrip({ sidebar, t }: {
  sidebar: DesktopSidebarService
  t: Translate<WorkspaceMessage>
}): JSX.Element | null {
  const snapshot = useSyncExternalStore(sidebar.subscribe, sidebar.getSnapshot)
  const stripRef = useRef<HTMLDivElement>(null)
  const tabs = snapshot.tabs.filter(tab => !PINNED_TAB_TYPES.has(tab.type))

  // Shared drag state machine: canvas rounded drag image + ID-based reordering.
  const drag = useTabStripDrag({
    source: 'side',
    onDrop: (payload, hoverId, side) => {
      if (payload.source === 'bottom') {
        sidebar.undockTabToSide(payload.tabId, hoverId === '' ? null : hoverId, side)
        return
      }
      sidebar.reorderTabs(payload.tabId, hoverId === '' ? null : hoverId, side)
    },
  })

  useEffect(() => {
    // The wheel binding depends on the strip element being in the DOM.
    // When tabs.length is 0 the component returns null before the element
    // mounts, and the []-only effect would never bind after tabs appear.
    // This dependency ensures the effect re-runs when tabs appear (or
    // disappear), binding the wheel handler to the now-mounted strip.
    if (tabs.length === 0) return
    const el = stripRef.current
    if (el === null) return
    // Wheel over the overflowed tab row scrolls it horizontally (the
    // surface-tab strip helper; non-passive so the page does not scroll).
    return bindTabStripWheel(el)
  }, [tabs.length])
  if (tabs.length === 0) return null

  return (
    <div
      ref={stripRef}
      className="oh-dsh-side-tabs"
      role="tablist"
      {...drag.strip.handlers}
    >
      {tabs.map(tab => {
        const dropClass = drag.chip.markerClass(tab.id)
        return (
          <SurfaceTab
            key={tab.id}
            label={tab.title}
            title={tab.title}
            active={tab.id === snapshot.activeId}
            badge={tabBadge(sidebar, tab)}
            {...(dropClass === undefined ? {} : { className: dropClass })}
            draggable={drag.chip.handlers.draggable}
            onDragStart={event => { drag.chip.handlers.onDragStart(event, tab.id, tab.title) }}
            onDragEnter={event => { drag.chip.handlers.onDragEnter(event, tab.id) }}
             onDragOver={event => { drag.chip.handlers.onDragOver(event, tab.id) }}
            onDrop={event => { drag.chip.handlers.onDrop(event, tab.id) }}
            onDragEnd={drag.chip.handlers.onDragEnd}
            onSelect={() => {
              // A drag in progress must not activate chips beneath the pointer.
              if (drag.strip.dragging) return
              sidebar.activateTab(tab.id)
            }}
            onClose={() => { sidebar.closeTab(tab.id) }}
            closeLabel={t('side.close-named-tab', { title: tab.title })}
             tabId={tab.id}
          />
        )
      })}
    </div>
  )
}

/* The window-level panel controls (expand/restore, side-panel toggle) live
   in the panel's top row, flush right — no floating toolbar. The terminal
   toggle used to sit here and open the bottom-mounted terminal dock; the
   dock is removed and the terminal is now a first-class surface instead:
   open it as a right-rail tab or in the center through the middle "+" menu
   (see builtins/tabs.tsx and center-surface-host.tsx). */
function PanelActions({
  maximized,
  onToggleMaximized,
  onToggleSide,
  open,
  t,
}: {
  maximized: boolean
  onToggleMaximized(): void
  onToggleSide(): void
  open: boolean
  panels: DesktopPanels
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  // CUT: the terminal toggle (previously `panels.isBottomPanelOpen()` +
  // `panels.toggleBottomPanel()`) — the bottom terminal dock no longer
  // mounts (see plugins/panel-controls).
  return (
    <div className="oh-dsh-side-tabs-actions" role="presentation">
      <button
        type="button"
        aria-label={t('side.expand')}
        aria-pressed={maximized}
        title={maximized ? t('side.restore') : t('side.expand')}
        onClick={onToggleMaximized}
      >{maximized ? <IconRestore size={16} /> : <IconMaximize size={16} />}</button>
      <button
        type="button"
        aria-label={t('side.toggle')}
        aria-pressed={open}
        title={`${t('side.title')} (${formatKeymapHint(binding({ mod: true, alt: true, key: 'b' }))})`}
        onClick={onToggleSide}
      >
        <span className="oh-dsh-side-toggle-glyph" aria-hidden="true">
          <IconSidebarRightFilled />
        </span>
      </button>
    </div>
  )
}

export function SideToolsPanel(props: SideToolsPanelProps): JSX.Element {
  const snapshot = useSyncExternalStore(
    props.sidebar.subscribe,
    props.sidebar.getSnapshot,
  )
  const activeTab = snapshot.tabs.find(tab => tab.id === snapshot.activeId)
  const descriptor = activeTab === undefined
    ? undefined
    : props.sidebar.getTab(activeTab.type)
  const beginResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = props.width
    // Live drags are rAF-coalesced to ONE preview update per frame and the
    // final width is committed only on pointerup/cancel — never per event —
    // keeping every synchronous layout write and React commit off the
    // pointermove hot path (see workspace-tools.previewResizeWidth).
    let rafId = 0
    let lastWidth = startWidth
    const schedulePreview = (width: number): void => {
      lastWidth = width
      if (rafId !== 0) return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        props.onResizePreview(lastWidth)
      })
    }
    const move = (next: PointerEvent): void => {
      schedulePreview(startWidth + startX - next.clientX)
    }
    const finish = (): void => {
      if (rafId !== 0) {
        cancelAnimationFrame(rafId)
        rafId = 0
      }
      props.onResize(lastWidth)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }
  const title = activeTab?.title ?? props.t('side.title')
  const renderProps: SidebarRenderProps | undefined = activeTab === undefined
    ? undefined
    : {
      active: props.open,
      close: () => { props.sidebar.closeTab(activeTab.id) },
      patch: patch => { props.sidebar.updateTab(activeTab.id, patch) },
      scope: snapshot.scope,
      tab: activeTab,
    }
  const content: ReactNode = activeTab === undefined
    ? <SideMenu {...props} />
    : descriptor?.render === undefined || renderProps === undefined
      ? <OrphanedTab tab={activeTab} t={props.t} />
      : descriptor.render(renderProps)
  return (
    <aside
      className="oh-dsh-workspace-panel oh-dsh-side-panel"
      data-open={String(props.open)}
      data-maximized={String(props.maximized)}
      aria-hidden={!props.open}
      aria-label={title}
      style={{ width: '100%' }}
    >
      {!props.maximized && (
        <div
          className="oh-dsh-workspace-resize"
          onPointerDown={beginResize}
          aria-hidden="true"
        />
      )}
      <div className="oh-dsh-side-top">
        <PinnedTabs sidebar={props.sidebar} t={props.t} cwd={props.cwd} />
        <TabStrip sidebar={props.sidebar} t={props.t} />
        <AddToolsMenu sidebar={props.sidebar} t={props.t} />
        <PanelActions
          maximized={props.maximized}
          onToggleMaximized={props.onToggleMaximized}
          onToggleSide={props.onToggleSide}
          open={props.open}
          panels={props.panels}
          t={props.t}
        />
      </div>
      {content}
    </aside>
  )
}
