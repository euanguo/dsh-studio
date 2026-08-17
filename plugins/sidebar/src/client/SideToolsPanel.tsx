import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import {
  IconBranchOutline16,
  IconBrowseOutline16,
  IconCodeOutline16,
  IconEllipsisOutline16,
  IconFolderOpenOutline16,
  IconListPenOutline16,
  IconNewChatOutline16,
  Menu,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '../../../shared/i18n.ts'
import type { DesktopPanels } from '../../../panel-controls/src/client.ts'
import {
  IconClose,
  IconExpand,
  IconMinus,
  IconRefresh,
  IconRestore,
} from '../../../shared/icons.tsx'
import {
  IconChevronDown,
  IconChevronRight,
  IconPlus,
  FileGlyph,
  IconBottombarFilled,
  IconSidebarRightFilled,
} from '../../../shared/tabler-icons.tsx'
import {
  basename,
  dirname,
  isUnderRoot,
  joinPath,
  relativePathOf,
  resolveSidebarPath,
} from '../../../shared/path.ts'
import type { WorkspaceFilesResponse, WorkspaceFileEntry, WorkspaceFileKind } from '../protocol.ts'
import { EmptyView, ErrorView, LoadingView } from './kit/status.tsx'
import {
  betterSidebarApi,
  mapBetterSidebarFile,
} from './better-sidebar-api.ts'
import { buildFileRows } from './files/file-tree-model.ts'
import {
  ListRow,
  ListRowBody,
  ListRowLeading,
  ListRowMain,
  ListRowTrailing,
} from '../../../shared/list-row.tsx'
import { FilenameLabel } from '../../../shared/filename-label.tsx'
import { SurfaceTab } from '../../../shared/surface-tab.tsx'
import { bindTabStripWheel } from '../../../shared/tab-strip-wheel.ts'
import {
  fullTabDropIndex,
  parseTabDrag,
  reorderIndexAfterRemoval,
  serializeTabDrag,
  TAB_DRAG_MIME,
  tabDropSideOf,
  type TabDropSide,
} from './tab-drag.ts'
import { Scrollable } from '../../../shared/scrollable.tsx'
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
  SidebarTabDescriptor,
} from './contract.ts'
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
  onResize(width: number): void
  onToggleMaximized(): void
  onToggleSide(): void
  open: boolean
  panels: DesktopPanels
  sidebar: DesktopSidebarService
  t: Translate<WorkspaceMessage>
  width: number
}

type ToolIconKind =
  | 'browser'
  | 'chat'
  | 'file'
  | 'files'
  | 'review'
  | 'subagent'
  | 'terminal'
  | 'trajectory'

export function ToolIcon({ kind }: { kind: ToolIconKind }): JSX.Element {
  if (kind === 'review') return <svg viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="16" rx="3" /><path d="M9 9h6M9 13h6M12 7v4" /></svg>
  if (kind === 'terminal') return <svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="3" /><path d="m8 10 2 2-2 2M13 15h3" /></svg>
  if (kind === 'browser') return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></svg>
  if (kind === 'files') return <svg viewBox="0 0 24 24"><path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h4l2 2h6A2.5 2.5 0 0 1 20.5 9.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5z" /></svg>
  if (kind === 'file') return <svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6zM14 3v5h5" /></svg>
  if (kind === 'chat') return <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M11 7v8M7 11h8M16 16l4 4" /></svg>
  if (kind === 'subagent') return <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2.5" /><circle cx="5" cy="18" r="2.5" /><circle cx="19" cy="18" r="2.5" /><path d="M12 7.5v4M5 16v-2.5h14V16M12 11.5 5 15.5M12 11.5l7 4" /></svg>
  return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l-3 2" /></svg>
}

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
  onClick(): void
}): JSX.Element {
  return (
    <button
      className="oh-dsh-side-tool-row"
      type="button"
      disabled={props.disabled}
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
  const descriptors = props.sidebar.getTabs().filter(descriptor =>
    descriptor.hidden !== true && props.sidebar.isTabEnabled(descriptor.id),
  )
  return (
    <Scrollable className="oh-dsh-side-menu">
      {descriptors.map(descriptor => (
        <ToolRow
          key={descriptor.id}
          descriptor={descriptor}
          disabled={(descriptor.requiresWorkspace === true && props.cwd === undefined)
            || descriptor.available?.(snapshot.scope, snapshot) === false}
          onClick={() => { void open(descriptor) }}
        />
      ))}
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

export function FilesView({
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
      : getExplorerRuntime({ sessionId: scope.sessionId, cwd: scope.cwd })),
    [scope?.cwd, scope?.sessionId],
  )
  const listingsFingerprint = useSyncExternalStore(
    useCallback((listener: () => void) => runtime?.subscribe(listener) ?? (() => {}), [runtime]),
    useCallback(() => runtime?.listingsFingerprint() ?? 'none', [runtime]),
  )
  const scopeKey = scope === null || scope.cwd === undefined
    ? null
    : sidebarScopeKey({ sessionId: scope.sessionId, cwd: scope.cwd })
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
      void betterSidebarApi.fsSearch(scope, searchQuery, false, controller.signal).then(hits => {
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
  }, [cwd, scope?.sessionId, searchQuery])

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
    useCenterSurfaceStore.getState().openFile({ sessionId: scope?.sessionId ?? '', cwd, filePath, title: name, preview })
  }

  const createFsEntry = async (directory: boolean): Promise<void> => {
    if (cwd === undefined || scope == null) return
    const base = selectedPath ?? cwd
    const name = await promptDialog({
      title: directory ? t('files.new-folder-name') : t('files.new-file-name'),
      confirmLabel: t('dialog.ok'),
      cancelLabel: t('dialog.cancel'),
    })
    if (name === null || name.trim() === '') return
    try {
      await betterSidebarApi.fsCreate(scope, joinPath(base, name.trim()), directory)
      refreshListings()
    } catch (cause) {
      await alertDialog({
        title: t('files.op-failed'),
        message: cause instanceof Error ? cause.message : String(cause),
        confirmLabel: t('dialog.ok'),
      })
    }
  }

  const renameFsEntry = async (): Promise<void> => {
    if (cwd === undefined || scope == null || selectedPath === null) return
    const name = await promptDialog({
      title: t('files.rename-to'),
      defaultValue: basename(selectedPath),
      confirmLabel: t('dialog.ok'),
      cancelLabel: t('dialog.cancel'),
    })
    if (name === null || name.trim() === '') return
    const parent = dirname(selectedPath) || cwd
    try {
      await betterSidebarApi.fsRename(scope, selectedPath, joinPath(parent, name.trim()))
      refreshListings()
    } catch (cause) {
      await alertDialog({
        title: t('files.op-failed'),
        message: cause instanceof Error ? cause.message : String(cause),
        confirmLabel: t('dialog.ok'),
      })
    }
  }

  const deleteFsEntry = async (): Promise<void> => {
    if (cwd === undefined || scope == null || selectedPath === null) return
    const confirmed = await confirmDialog({
      title: t('files.delete'),
      message: t('files.delete-confirm', { path: selectedPath }),
      confirmLabel: t('files.delete'),
      cancelLabel: t('dialog.cancel'),
      danger: true,
    })
    if (!confirmed) return
    try {
      await betterSidebarApi.fsDelete(scope, selectedPath)
      refreshListings()
    } catch (cause) {
      await alertDialog({
        title: t('files.op-failed'),
        message: cause instanceof Error ? cause.message : String(cause),
        confirmLabel: t('dialog.ok'),
      })
    }
  }

  const copyFsEntry = async (): Promise<void> => {
    if (cwd === undefined || scope == null || selectedPath === null) return
    const base = basename(selectedPath)
    const target = await promptDialog({
      title: t('files.copy-to'),
      defaultValue: `${base}.copy`,
      confirmLabel: t('dialog.ok'),
      cancelLabel: t('dialog.cancel'),
    })
    if (target === null || target.trim() === '') return
    try {
      await betterSidebarApi.fsCopy(scope, selectedPath, target.trim())
      refreshListings()
    } catch (cause) {
      await alertDialog({
        title: t('files.op-failed'),
        message: cause instanceof Error ? cause.message : String(cause),
        confirmLabel: t('dialog.ok'),
      })
    }
  }

  if (cwd === undefined) {
    return <div className="oh-dsh-side-empty">{t('files.select-workspace')}</div>
  }
  return (
    <div className="oh-dsh-files-view">
      <div className="oh-dsh-files-path" title={cwd}>
        <span>{basename(cwd)}</span>
        <button type="button" title={t('files.new-file')} onClick={() => { void createFsEntry(false) }}>+F</button>
        <button type="button" title={t('files.new-folder')} onClick={() => { void createFsEntry(true) }}>+D</button>
        <button type="button" title={t('files.rename')} disabled={selectedPath === null} onClick={() => { void renameFsEntry() }}>↳</button>
        <button type="button" title={t('files.copy')} disabled={selectedPath === null} onClick={() => { void copyFsEntry() }}>⧉</button>
        <button type="button" title={t('files.delete')} disabled={selectedPath === null} onClick={() => { void deleteFsEntry() }}>✕</button>
        <button
          type="button"
          aria-label={t('files.refresh')}
          title={t('files.refresh')}
          onClick={refreshListings}
        ><IconRefresh size={16} /></button>
      </div>
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
                  sessionId: scope?.sessionId ?? '',
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
      <Scrollable className="oh-dsh-file-list">
        {rows.map(row => (
          <ListRow
            key={row.key}
            selected={row.selected}
            title={row.path}
            data-path={row.path}
          >
            <ListRowMain
              className="oh-dsh-files-depth-main"
              style={{ '--tree-depth': row.depth } as CSSProperties}
              aria-expanded={row.kind === 'directory' ? row.expanded : undefined}
              onClick={() => {
                if (row.kind === 'directory') {
                  void toggleDirectory(row.path)
                } else {
                  // Select the file (drives rename/copy/delete) and preview
                  // it in the center; double click pins the tab.
                  if (scopeKey !== null) {
                    useSidebarChromeStore.getState().setExplorerSelectedPath(scopeKey, row.path)
                  }
                  openFileInCenter(row.path, row.name, true)
                }
              }}
              onDoubleClick={() => {
                if (row.kind !== 'directory') {
                  openFileInCenter(row.path, row.name, false)
                }
              }}
            >
              <ListRowLeading aria-hidden="true">
                {row.kind === 'directory'
                  ? row.expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />
                  : null}
              </ListRowLeading>
              <FileGlyph path={row.path} kind={row.kind} expanded={row.expanded} />
              <ListRowBody>
                <FilenameLabel name={row.name} title={row.path} />
              </ListRowBody>
            </ListRowMain>
            {row.kind !== 'directory' && (
              <ListRowTrailing>
                <span className="oh-dsh-files-size">{formatSize(row.size)}</span>
              </ListRowTrailing>
            )}
          </ListRow>
        ))}
        {!loading && !error && rows.length === 0 && (
          <EmptyView title={t('files.empty-directory')} />
        )}
      </Scrollable>
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
    void betterSidebarApi.fsRead(scope, path, controller.signal).then(
      result => {
        setSnapshot(mapBetterSidebarFile(cwd, path, result))
        setError('')
      },
    ).catch((next: unknown) => {
      if (!controller.signal.aborted) {
        setError(next instanceof Error ? next.message : String(next))
      }
    })
    return () => { controller.abort() }
  }, [cwd, path, scope?.sessionId])

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
   SurfaceTab chip (the same component the center tab strip uses). */
function PinnedTabs({ sidebar, t }: {
  sidebar: DesktopSidebarService
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const snapshot = useSyncExternalStore(sidebar.subscribe, sidebar.getSnapshot)
  const activeType = snapshot.tabs.find(tab => tab.id === snapshot.activeId)?.type ?? null
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
  return (
    <div className="oh-dsh-side-pinned" role="tablist">
      <SurfaceTab
        label={t('files')}
        icon={<ToolIcon kind="files" />}
        active={activeType === 'files'}
        badge={filesTab === undefined ? null : tabBadge(sidebar, filesTab)}
        onSelect={() => { openType('files') }}
      />
      <SurfaceTab
        label={t('side.git')}
        icon={<ToolIcon kind="review" />}
        active={activeType === 'review'}
        badge={reviewTab === undefined ? null : tabBadge(sidebar, reviewTab)}
        onSelect={() => { openType('review') }}
      />
    </div>
  )
}

/* [+] menu rows use the official outline-16 icon set (the same set the left
   rail's picker menu uses); unknown descriptors fall back to the ellipsis. */
const TOOL_MENU_ICONS: Readonly<Record<string, ReactNode>> = {
  browser: <IconBrowseOutline16 />,
  files: <IconFolderOpenOutline16 />,
  review: <IconBranchOutline16 />,
  'side-chat': <IconNewChatOutline16 />,
  terminal: <IconCodeOutline16 />,
  trajectory: <IconListPenOutline16 />,
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
      icon: TOOL_MENU_ICONS[descriptor.id] ?? <IconEllipsisOutline16 />,
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
  const [marker, setMarker] = useState<{ id: string; side: TabDropSide } | null>(null)
  const draggingRef = useRef(false)
  const tabs = snapshot.tabs.filter(tab => !PINNED_TAB_TYPES.has(tab.type))
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

  const acceptDrag = (event: ReactDragEvent): boolean => {
    if (!event.dataTransfer.types.includes(TAB_DRAG_MIME)) return false
    event.preventDefault()
    return true
  }
  const dropTargetOf = (hoverId: string, side: TabDropSide): number =>
    fullTabDropIndex(snapshot.tabs, PINNED_TAB_TYPES, hoverId, side)

  const handleStripDrop = (event: ReactDragEvent<HTMLDivElement>): void => {
    const payload = parseTabDrag(event.dataTransfer.getData(TAB_DRAG_MIME))
    setMarker(null)
    if (payload === null) return
    event.preventDefault()
    // A docked tab dropped on the rail's empty space returns to the rail
    // (append). A rail tab dropped on its own strip background is a no-op.
    if (payload.source === 'bottom') sidebar.moveBottomTabToSide(payload.tabId)
  }

  return (
    <div
      ref={stripRef}
      className="oh-dsh-side-tabs"
      role="tablist"
      onDragOver={event => {
        if (!acceptDrag(event)) return
        // Background (not a chip): clear the chip marker (append target).
        if ((event.target as HTMLElement).closest('[data-slot="surface-tab"]') === null) {
          setMarker(null)
        }
      }}
      onDrop={handleStripDrop}
      onDragLeave={() => { setMarker(null) }}
    >
      {tabs.map(tab => (
        <SurfaceTab
          key={tab.id}
          label={tab.title}
          title={tab.title}
          active={tab.id === snapshot.activeId}
          badge={tabBadge(sidebar, tab)}
          draggable
          {...(marker !== null && marker.id === tab.id
            ? { className: `is-drop-${marker.side}` }
            : {})}
          onDragStart={event => {
            draggingRef.current = true
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData(TAB_DRAG_MIME, serializeTabDrag({
              kind: 'sidebar-tab',
              tabId: tab.id,
              source: 'side',
            }))
          }}
          onDragOver={event => {
            if (!acceptDrag(event)) return
            setMarker({
              id: tab.id,
              side: tabDropSideOf(event.nativeEvent.offsetX, event.currentTarget.clientWidth),
            })
          }}
          onDrop={event => {
            const payload = parseTabDrag(event.dataTransfer.getData(TAB_DRAG_MIME))
            setMarker(null)
            if (payload === null) return
            event.preventDefault()
            const side = marker !== null && marker.id === tab.id ? marker.side : 'before'
            const target = dropTargetOf(tab.id, side)
            if (payload.source === 'bottom') {
              sidebar.moveBottomTabToSide(payload.tabId, target)
              return
            }
            const from = snapshot.tabs.findIndex(candidate => candidate.id === payload.tabId)
            if (from === -1) return
            sidebar.moveTab(payload.tabId, reorderIndexAfterRemoval(from, target))
          }}
          onDragEnd={() => {
            draggingRef.current = false
            setMarker(null)
          }}
          onSelect={() => {
            if (draggingRef.current) return
            sidebar.activateTab(tab.id)
          }}
          onClose={() => { sidebar.closeTab(tab.id) }}
          closeLabel={t('side.close-named-tab', { title: tab.title })}
        />
      ))}
    </div>
  )
}

/* The window-level panel controls (expand/restore, terminal, side-panel
   toggle) live in the panel's top row, flush right — no floating toolbar. */
function PanelActions({
  maximized,
  onToggleMaximized,
  onToggleSide,
  open,
  panels,
  t,
}: {
  maximized: boolean
  onToggleMaximized(): void
  onToggleSide(): void
  open: boolean
  panels: DesktopPanels
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const terminalOpen = useSyncExternalStore(panels.subscribe, () => panels.isBottomPanelOpen())
  return (
    <div className="oh-dsh-side-tabs-actions" role="presentation">
      <button
        type="button"
        aria-label={t('side.expand')}
        aria-pressed={maximized}
        title={maximized ? t('side.restore') : t('side.expand')}
        onClick={onToggleMaximized}
      >{maximized ? <IconRestore size={16} /> : <IconExpand size={16} />}</button>
      <button
        type="button"
        aria-label={t('terminal.toggle')}
        aria-pressed={terminalOpen}
        title={`${t('terminal.title')} (${formatKeymapHint(binding({ mod: true, key: 'j' }))})`}
        onClick={() => { panels.toggleBottomPanel() }}
      >
        <span className="oh-dsh-side-toggle-glyph" aria-hidden="true">
          <IconBottombarFilled />
        </span>
      </button>
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
    const move = (next: PointerEvent): void => {
      props.onResize(startWidth + startX - next.clientX)
    }
    const finish = (): void => {
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
        <PinnedTabs sidebar={props.sidebar} t={props.t} />
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
