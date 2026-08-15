import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import type { Translate } from '../../../shared/i18n.ts'
import type { DesktopPanels } from '../../../panel-controls/src/client.ts'
import {
  IconArrowLeft,
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
} from '../../../shared/tabler-icons.tsx'
import type { WorkspaceFilesResponse, WorkspaceFileEntry, WorkspaceFileKind } from '../protocol.ts'
import {
  betterSidebarApi,
  mapBetterSidebarFile,
  type BetterSidebarScope,
} from './better-sidebar-api.ts'
import { buildFileRows } from './file-tree-model.ts'
import {
  ListRow,
  ListRowBody,
  ListRowLeading,
  ListRowMain,
  ListRowTrailing,
} from '../../../shared/list-row.tsx'
import { FilenameLabel } from '../../../shared/filename-label.tsx'
import { SurfaceTab } from '../../../shared/surface-tab.tsx'
import {
  getExplorerRuntime,
  resolveSidebarPath,
  sidebarScopeKey,
} from './runtimes/registry.ts'
import { useSidebarChromeStore } from './runtimes/chrome-store.ts'
import { useCenterSurfaceStore } from './surfaces/center-surface-store.ts'
import type {
  DesktopSidebar,
  DesktopSidebarRenderProps,
  DesktopSidebarTabDescriptor,
} from './sidebar-service.ts'
import type { WorkspaceMessage } from './i18n.ts'

/** Absolute path → repo-relative path for the explorer runtime keys. */
function relativePathOf(cwd: string, absolute: string): string {
  const root = cwd.replace(/[/\\]+$/, '')
  const value = absolute.replace(/\\/g, '/')
  if (value === root) return ''
  if (value.startsWith(`${root}/`)) return value.slice(root.length + 1)
  return absolute.replace(/^[/\\]+/, '').replace(/\\/g, '/')
}

interface ElectronWebviewElement extends HTMLElement {
  canGoBack(): boolean
  getURL(): string
  goBack(): void
  loadURL(url: string): Promise<void>
  reload(): void
}

interface SideToolsPanelProps {
  cwd: string | undefined
  maximized: boolean
  onClose(): void
  onResize(width: number): void
  onToggleMaximized(): void
  onToggleSide(): void
  open: boolean
  panels: DesktopPanels
  sidebar: DesktopSidebar
  t: Translate<WorkspaceMessage>
  width: number
}

type ToolIconKind =
  | 'browser'
  | 'chat'
  | 'file'
  | 'files'
  | 'review'
  | 'terminal'
  | 'trajectory'

export function ToolIcon({ kind }: { kind: ToolIconKind }): JSX.Element {
  if (kind === 'review') return <svg viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="16" rx="3" /><path d="M9 9h6M9 13h6M12 7v4" /></svg>
  if (kind === 'terminal') return <svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="3" /><path d="m8 10 2 2-2 2M13 15h3" /></svg>
  if (kind === 'browser') return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></svg>
  if (kind === 'files') return <svg viewBox="0 0 24 24"><path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h4l2 2h6A2.5 2.5 0 0 1 20.5 9.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5z" /></svg>
  if (kind === 'file') return <svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6zM14 3v5h5" /></svg>
  if (kind === 'chat') return <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M11 7v8M7 11h8M16 16l4 4" /></svg>
  return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l-3 2" /></svg>
}

function defaultIcon(id: string): ToolIconKind {
  if (id === 'review' || id === 'terminal' || id === 'browser'
    || id === 'files' || id === 'trajectory') return id
  if (id === 'side-chat') return 'chat'
  return 'file'
}

function descriptorTitle(descriptor: DesktopSidebarTabDescriptor): string {
  return typeof descriptor.title === 'function'
    ? descriptor.title()
    : descriptor.title
}

function DescriptorIcon({ descriptor }: {
  descriptor: DesktopSidebarTabDescriptor
}): JSX.Element {
  const icon = typeof descriptor.icon === 'function'
    ? descriptor.icon(21)
    : descriptor.icon
  return <>{icon ?? <ToolIcon kind={defaultIcon(descriptor.id)} />}</>
}

function ToolRow(props: {
  descriptor: DesktopSidebarTabDescriptor
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
  const open = async (descriptor: DesktopSidebarTabDescriptor): Promise<void> => {
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
  const descriptors = props.sidebar.getTabs().filter(descriptor =>
    descriptor.hidden !== true && props.sidebar.isTabEnabled(descriptor.id),
  )
  return (
    <div className="oh-dsh-side-menu">
      {descriptors.map(descriptor => (
        <ToolRow
          key={descriptor.id}
          descriptor={descriptor}
          disabled={(descriptor.requiresWorkspace === true && props.cwd === undefined)
            || descriptor.available?.() === false}
          onClick={() => { void open(descriptor) }}
        />
      ))}
      {error !== '' && <div className="oh-dsh-side-error" role="alert">{error}</div>}
      <button
        type="button"
        className="oh-dsh-side-menu-close"
        aria-label={props.t('side.close')}
        onClick={props.onClose}
      ><IconClose size={16} /></button>
    </div>
  )
}

function normalizeBrowserUrl(
  raw: string,
  t: Translate<WorkspaceMessage>,
): string {
  const value = raw.trim()
  if (value === '') throw new Error(t('browser.enter-url'))
  const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value)
    ? value
    : `https://${value}`)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(t('browser.http-only'))
  }
  return url.href
}

export function BrowserView({
  patch,
  t,
  tab,
}: DesktopSidebarRenderProps & {
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const container = useRef<HTMLDivElement | null>(null)
  const webview = useRef<ElectronWebviewElement | null>(null)
  const [address, setAddress] = useState(tab.resource ?? '')
  const [error, setError] = useState('')
  const [canGoBack, setCanGoBack] = useState(false)

  useEffect(() => {
    const host = container.current
    if (host === null) return
    const element = document.createElement('webview') as unknown as ElectronWebviewElement
    element.className = 'oh-dsh-browser-webview'
    element.setAttribute('partition', 'persist:oh-dsh-browser')
    element.setAttribute('src', tab.resource ?? 'about:blank')
    const update = (event: Event): void => {
      const next = 'url' in event && typeof event.url === 'string'
        ? event.url
        : element.getURL()
      if (next !== '' && next !== 'about:blank') {
        try {
          const safe = normalizeBrowserUrl(next, t)
          const url = new URL(safe)
          setAddress(safe)
          patch({ resource: safe, title: url.hostname || t('browser') })
        } catch (nextError) {
          setError(nextError instanceof Error ? nextError.message : String(nextError))
        }
      }
      setCanGoBack(element.canGoBack())
    }
    const guard = (event: Event): void => {
      if (!('url' in event) || typeof event.url !== 'string') return
      try {
        normalizeBrowserUrl(event.url, t)
      } catch (nextError) {
        event.preventDefault()
        setError(nextError instanceof Error ? nextError.message : String(nextError))
      }
    }
    const failed = (event: Event): void => {
      const description = 'errorDescription' in event
        ? String(event.errorDescription)
        : t('browser.page-failed')
      setError(description)
    }
    element.addEventListener('did-navigate', update)
    element.addEventListener('did-navigate-in-page', update)
    element.addEventListener('will-navigate', guard)
    element.addEventListener('did-fail-load', failed)
    host.append(element)
    webview.current = element
    return () => {
      webview.current = null
      element.remove()
    }
  }, [tab.id])

  const navigate = async (): Promise<void> => {
    try {
      const url = normalizeBrowserUrl(address, t)
      setAddress(url)
      setError('')
      await webview.current?.loadURL(url)
    } catch (next) {
      setError(next instanceof Error ? next.message : String(next))
    }
  }

  return (
    <div className="oh-dsh-browser-view">
      <form
        className="oh-dsh-browser-bar"
        onSubmit={event => { event.preventDefault(); void navigate() }}
      >
        <button
          type="button"
          disabled={!canGoBack}
          aria-label={t('browser.back')}
          onClick={() => { webview.current?.goBack() }}
        ><IconArrowLeft size={16} /></button>
        <button
          type="button"
          aria-label={t('browser.reload')}
          onClick={() => { webview.current?.reload() }}
        ><IconRefresh size={16} /></button>
        <input
          value={address}
          placeholder={t('browser.enter-url')}
          aria-label={t('browser.url')}
          onChange={event => { setAddress(event.currentTarget.value) }}
        />
        <button type="submit">{t('browser.go')}</button>
      </form>
      {error !== '' && <div className="oh-dsh-browser-error" role="alert">{error}</div>}
      <div ref={container} className="oh-dsh-browser-host" />
    </div>
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
}: DesktopSidebarRenderProps & {
  scope: BetterSidebarScope | undefined
  sidebar: DesktopSidebar
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const cwd = scope?.cwd
  // Retained explorer runtime: switching tabs back hits the cached listings
  // (zero network), because the registry keeps the instance alive.
  const runtime = useMemo(
    () => (scope === undefined || scope.cwd === undefined
      ? null
      : getExplorerRuntime({ sessionId: scope.sessionId, cwd: scope.cwd })),
    [scope?.cwd, scope?.sessionId],
  )
  const listingsFingerprint = useSyncExternalStore(
    useCallback((listener: () => void) => runtime?.subscribe(listener) ?? (() => {}), [runtime]),
    useCallback(() => runtime?.listingsFingerprint() ?? 'none', [runtime]),
  )
  const scopeKey = scope === undefined || scope.cwd === undefined
    ? null
    : sidebarScopeKey({ sessionId: scope.sessionId, cwd: scope.cwd })
  const chrome = useSidebarChromeStore(state =>
    scopeKey === null ? null : state.getSlice(scopeKey))
  const expandedDirs = useMemo(
    () => new Set(chrome?.explorer.expandedPaths ?? []),
    [chrome?.explorer.expandedPaths],
  )
  const selectedPath = chrome?.explorer.selectedPath ?? null
  const [refreshKey, setRefreshKey] = useState(0)

  // Tree mode expands from the workspace root; ensureListing short-circuits
  // on Ready/Empty — revisiting after a tab switch costs zero network.
  useEffect(() => {
    if (runtime === null || cwd === undefined) return
    void runtime.ensureListing(null)
  }, [cwd, refreshKey, runtime])

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

  if (cwd === undefined) {
    return <div className="oh-dsh-side-empty">{t('files.select-workspace')}</div>
  }
  return (
    <div className="oh-dsh-files-view">
      <div className="oh-dsh-files-path" title={cwd}>
        <span>{cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd}</span>
        <button
          type="button"
          aria-label={t('files.refresh')}
          title={t('files.refresh')}
          onClick={() => { setRefreshKey(value => value + 1) }}
        ><IconRefresh size={16} /></button>
      </div>
      {loading && !entriesByDir.has(cwd) && <div className="oh-dsh-side-muted">{t('files.loading')}</div>}
      {error !== '' && <div className="oh-dsh-side-error" role="alert">{error}</div>}
      <div className="oh-dsh-file-list">
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
                if (row.kind === 'directory') void toggleDirectory(row.path)
                else openFileInCenter(row.path, row.name, true)
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
          <div className="oh-dsh-side-muted">{t('files.empty-directory')}</div>
        )}
      </div>
    </div>
  )
}

export function FileView({
  onOpenPath,
  scope,
  sidebar,
  t,
  tab,
}: DesktopSidebarRenderProps & {
  scope: BetterSidebarScope | undefined
  onOpenPath(path: string): Promise<void>
  sidebar: DesktopSidebar
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const cwd = scope?.cwd
  const [snapshot, setSnapshot] = useState<WorkspaceFilesResponse | null>(null)
  const [error, setError] = useState('')
  const path = tab.resource

  useEffect(() => {
    if (cwd === undefined || path === undefined || scope === undefined) return
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
  if (error !== '') return <div className="oh-dsh-side-error" role="alert">{error}</div>
  if (snapshot === null) return <div className="oh-dsh-side-muted">{t('files.loading')}</div>
  if (snapshot.kind !== 'file') {
    return <div className="oh-dsh-side-muted">{t('files.not-file')}</div>
  }
  const head = snapshot.binary
    ? new Uint8Array([0])
    : new TextEncoder().encode((snapshot.content ?? '').slice(0, 512))
  const viewer = sidebar.matchViewer(path, head)
  if (viewer?.render !== undefined) {
    return <>{viewer.render({
      ...(snapshot.content !== null ? { content: snapshot.content } : {}),
      path,
      title: tab.title,
    })}</>
  }
  return (
    <div className="oh-dsh-file-preview">
      <div>
        <strong>{tab.title}</strong>
        <button type="button" onClick={() => { void onOpenPath(path) }}>
          {t('files.open')}
        </button>
      </div>
      <div className="oh-dsh-side-muted">
        {t('files.no-viewer', { size: formatSize(snapshot.size) })}
      </div>
    </div>
  )
}

function OrphanedTab({ title, t }: {
  t: Translate<WorkspaceMessage>
  title: string
}): JSX.Element {
  return (
    <div className="oh-dsh-side-empty">
      <strong>{title}</strong>
      <p>{t('side.orphaned-tab')}</p>
    </div>
  )
}

/* Pinned panel entries — 文件 (files) and Git (review) stay one click away,
   everything else is added through the [+] menu. Rendered with the shared
   SurfaceTab chip (the same component the center tab strip uses). */
function PinnedTabs({ sidebar, t }: {
  sidebar: DesktopSidebar
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
  return (
    <div className="oh-dsh-side-pinned" role="tablist">
      <SurfaceTab
        label={t('files')}
        icon={<ToolIcon kind="files" />}
        active={activeType === 'files'}
        onSelect={() => { openType('files') }}
      />
      <SurfaceTab
        label={t('side.git')}
        icon={<ToolIcon kind="review" />}
        active={activeType === 'review'}
        onSelect={() => { openType('review') }}
      />
    </div>
  )
}

/* [+] menu: every enabled tool that is not open yet, as a small popover. */
function AddToolsMenu({ sidebar, t }: {
  sidebar: DesktopSidebar
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const snapshot = useSyncExternalStore(sidebar.subscribe, sidebar.getSnapshot)
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent): void => {
      if (menuRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', close, true)
    return () => { window.removeEventListener('mousedown', close, true) }
  }, [open])
  const descriptors = sidebar.getTabs().filter(descriptor =>
    descriptor.hidden !== true
    && sidebar.isTabEnabled(descriptor.id)
    && !snapshot.tabs.some(tab => tab.type === descriptor.id)
  )
  return (
    <div className="oh-dsh-add-tools" ref={menuRef}>
      <button
        type="button"
        aria-label={t('side.add-tool')}
        aria-expanded={open}
        title={t('side.add-tool')}
        onClick={() => { setOpen(value => !value) }}
      ><IconPlus size={14} /></button>
      {open && (
        <div className="oh-dsh-add-tools-menu" role="menu">
          {descriptors.map(descriptor => (
            <button
              type="button"
              role="menuitem"
              key={descriptor.id}
              onClick={() => {
                sidebar.openTab({ type: descriptor.id })
                setOpen(false)
              }}
            >
              <DescriptorIcon descriptor={descriptor} />
              <span>{descriptorTitle(descriptor)}</span>
            </button>
          ))}
          {descriptors.length === 0 && (
            <div className="oh-dsh-side-muted">{t('side.no-more-tools')}</div>
          )}
        </div>
      )}
    </div>
  )
}

/* Extra open tools (beyond the pinned 文件 / Git entries) as shared
   SurfaceTab chips. */
function TabStrip({ sidebar, t }: {
  sidebar: DesktopSidebar
  t: Translate<WorkspaceMessage>
}): JSX.Element | null {
  const snapshot = useSyncExternalStore(sidebar.subscribe, sidebar.getSnapshot)
  const pinnedTypes = new Set(['files', 'review'])
  const tabs = snapshot.tabs.filter(tab => !pinnedTypes.has(tab.type))
  if (tabs.length === 0) return null
  return (
    <div className="oh-dsh-side-tabs" role="tablist">
      {tabs.map(tab => (
        <SurfaceTab
          key={tab.id}
          label={tab.title}
          title={tab.title}
          active={tab.id === snapshot.activeId}
          onSelect={() => { sidebar.activateTab(tab.id) }}
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
        title={`${t('terminal.title')} (⌘J)`}
        onClick={() => { panels.toggleBottomPanel() }}
      >
        <svg viewBox="0 0 20 20"><rect x="3" y="3" width="14" height="14" rx="2.5" /><path d="M3.5 13.5h13" /></svg>
      </button>
      <button
        type="button"
        aria-label={t('side.toggle')}
        aria-pressed={open}
        title={`${t('side.title')} (⌥⌘B)`}
        onClick={onToggleSide}
      >
        <svg viewBox="0 0 20 20"><rect x="3" y="3" width="14" height="14" rx="2.5" /><path d="M12.5 3.5v13" /></svg>
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
  const renderProps: DesktopSidebarRenderProps | undefined = activeTab === undefined
    ? undefined
    : {
      active: props.open,
      close: () => { props.sidebar.closeTab(activeTab.id) },
      patch: patch => { props.sidebar.patchTab(activeTab.id, patch) },
      tab: activeTab,
    }
  const content: ReactNode = activeTab === undefined
    ? <SideMenu {...props} />
    : descriptor?.render === undefined || renderProps === undefined
      ? <OrphanedTab title={title} t={props.t} />
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
