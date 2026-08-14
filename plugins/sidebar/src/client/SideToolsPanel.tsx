import {
  useCallback,
  useEffect,
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
  IconExternalLink,
  IconLayoutList,
  IconList,
  IconListTree,
  IconPlus,
  FileGlyph,
} from '../../../shared/tabler-icons.tsx'
import type { WorkspaceFilesResponse, WorkspaceFileEntry, WorkspaceFileKind } from '../protocol.ts'
import {
  betterSidebarApi,
  mapBetterSidebarFile,
  type BetterSidebarScope,
} from './better-sidebar-api.ts'
import { FILE_BROWSE_MODES, buildFileRows, type FileBrowseMode } from './file-tree-model.ts'
import { DetachedPanel } from './detached-panel.tsx'
import { ContentViewer } from './content-viewer.tsx'
import type {
  DesktopSidebar,
  DesktopSidebarRenderProps,
  DesktopSidebarTabDescriptor,
} from './sidebar-service.ts'
import type { WorkspaceMessage } from './i18n.ts'

/** Persisted display-mode key of the file browser. */
const FILE_MODE_KEY = 'oh-dsh-desktop.files.mode'

function modeIcon(mode: FileBrowseMode): JSX.Element {
  if (mode === 'flat') return <IconLayoutList size={14} />
  if (mode === 'nested') return <IconList size={14} />
  return <IconListTree size={14} />
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
  const [mode, setMode] = useState<FileBrowseMode>(() => {
    const stored = window.localStorage.getItem(FILE_MODE_KEY)
    return stored === 'nested' || stored === 'tree' ? stored : 'flat'
  })
  const [path, setPath] = useState(tab.resource ?? cwd)
  const [entriesByDir, setEntriesByDir] = useState<ReadonlyMap<string, readonly WorkspaceFileEntry[]>>(new Map())
  const [expandedDirs, setExpandedDirs] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [preview, setPreview] = useState<{
    title: string
    content: string | null
    binary: boolean
    data?: string
  } | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const next = tab.resource ?? cwd
    setPath(next)
    setSelectedPath(null)
    setPreview(null)
  }, [cwd, tab.id, tab.resource])

  // Reset the lazy cache whenever the workspace or the root path changes.
  useEffect(() => {
    setEntriesByDir(new Map())
    setExpandedDirs(new Set())
  }, [cwd, tab.id])

  const ensureLoaded = useCallback(async (directory: string): Promise<boolean> => {
    if (scope === undefined || cwd === undefined) return false
    if (entriesByDir.has(directory)) return true
    setLoading(true)
    setError('')
    try {
      const listing = await betterSidebarApi.fsTree(scope, directory)
      const loaded: WorkspaceFileEntry[] = listing.entries.map(entry => ({
        kind: entry.isDir ? 'directory' : 'file',
        name: entry.name,
        path: entry.path,
        size: null,
      }))
      setEntriesByDir(previous => new Map(previous).set(directory, loaded))
      return true
    } catch (next) {
      setError(next instanceof Error ? next.message : String(next))
      return false
    } finally {
      setLoading(false)
    }
  }, [cwd, entriesByDir, scope])

  useEffect(() => {
    if (cwd === undefined || path === undefined || scope === undefined) return
    // Always (re)load the current directory — refreshKey forces a reload.
    setEntriesByDir(previous => new Map(previous).set(path, []))
    setLoading(true)
    setError('')
    const controller = new AbortController()
    void betterSidebarApi.fsTree(scope, path, controller.signal).then(
      listing => {
        const entries: WorkspaceFileEntry[] = listing.entries.map(entry => ({
          kind: entry.isDir ? 'directory' : 'file',
          name: entry.name,
          path: entry.path,
          size: null,
        }))
        setEntriesByDir(previous => {
          const next = new Map(previous)
          next.set(path, entries)
          return next
        })
        setError('')
      },
    ).catch((next: unknown) => {
      if (!controller.signal.aborted) {
        setError(next instanceof Error ? next.message : String(next))
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => { controller.abort() }
  }, [cwd, path, refreshKey, scope?.sessionId])

  const toggleDirectory = async (directory: string): Promise<void> => {
    if (mode !== 'tree') {
      setPath(directory)
      return
    }
    if (!entriesByDir.has(directory)) {
      await ensureLoaded(directory)
    }
    setExpandedDirs(previous => {
      const next = new Set(previous)
      if (next.has(directory)) next.delete(directory)
      else next.add(directory)
      return next
    })
  }

  const rows = buildFileRows({
    mode,
    currentPath: path ?? cwd ?? '',
    entriesByDir,
    expandedDirs,
    selectedPath,
  })

  const openPreview = async (filePath: string): Promise<void> => {
    if (scope === undefined) return
    setSelectedPath(filePath)
    setPreviewLoading(true)
    setPreviewError('')
    setPreview(null)
    try {
      const result = await betterSidebarApi.fsRead(scope, filePath)
      if (result.kind === 'binary') {
        setPreview({ title: filePath, content: null, binary: true, ...(result.data === undefined ? {} : { data: result.data }) })
      } else {
        setPreview({ title: filePath, content: result.content, binary: false })
      }
    } catch (next) {
      setPreviewError(next instanceof Error ? next.message : String(next))
    } finally {
      setPreviewLoading(false)
    }
  }

  const switchMode = (next: FileBrowseMode): void => {
    setMode(next)
    window.localStorage.setItem(FILE_MODE_KEY, next)
  }

  if (cwd === undefined) {
    return <div className="oh-dsh-side-empty">{t('files.select-workspace')}</div>
  }
  const current = path ?? cwd
  return (
    <div className="oh-dsh-files-view">
      <div className="oh-dsh-files-path" title={current}>
        <button
          type="button"
          disabled={current === cwd}
          aria-label={t('side.back')}
          onClick={() => {
            const parent = current.slice(0, current.lastIndexOf('/'))
            if (parent.length >= cwd.length) setPath(parent)
          }}
        ><IconArrowLeft size={16} /></button>
        <span>{current.slice(cwd.length) || '/'}</span>
        <button
          type="button"
          aria-label={t('files.refresh')}
          onClick={() => { setRefreshKey(value => value + 1) }}
        ><IconRefresh size={16} /></button>
        <div className="oh-dsh-files-modes" role="group" aria-label={t('files.modes')}>
          {FILE_BROWSE_MODES.map(option => (
            <button
              key={option}
              type="button"
              aria-label={t(`files.mode.${option}`)}
              title={t(`files.mode.${option}`)}
              aria-pressed={mode === option}
              onClick={() => { switchMode(option) }}
            >{modeIcon(option)}</button>
          ))}
        </div>
      </div>
      {loading && !entriesByDir.has(current) && <div className="oh-dsh-side-muted">{t('files.loading')}</div>}
      {error !== '' && <div className="oh-dsh-side-error" role="alert">{error}</div>}
      <div className="oh-dsh-file-list">
        {rows.map(row => (
          <div
            key={row.key}
            className="oh-dsh-files-row"
            data-selected={row.selected || undefined}
            title={row.path}
          >
            <button
              type="button"
              className="oh-dsh-files-row-main"
              style={{ '--tree-depth': row.depth } as CSSProperties}
              aria-expanded={row.kind === 'directory' ? row.expanded : undefined}
              onClick={() => {
                if (row.kind === 'directory') void toggleDirectory(row.path)
                else void openPreview(row.path)
              }}
              onDoubleClick={() => {
                if (row.kind !== 'directory') {
                  sidebar.openTab({
                    resource: row.path,
                    title: row.name,
                    type: 'file',
                  })
                }
              }}
            >
              {row.kind === 'directory' && (
                <span className="oh-dsh-files-chevron">
                  {row.expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                </span>
              )}
              <FileGlyph path={row.path} kind={row.kind} expanded={row.expanded} />
              <span className="oh-dsh-files-name" title={row.name}>{row.name}</span>
            </button>
            {row.kind !== 'directory' && (
              <span className="oh-dsh-files-size">{formatSize(row.size)}</span>
            )}
          </div>
        ))}
        {!loading && !error && rows.length === 0 && (
          <div className="oh-dsh-side-muted">{t('files.empty-directory')}</div>
        )}
      </div>

      {selectedPath !== null && (
        <DetachedPanel
          title={preview?.title ?? selectedPath}
          closeLabel={t('overlay.close')}
          onClose={() => {
            setSelectedPath(null)
            setPreview(null)
            setPreviewError('')
          }}
          actions={
            <button
              type="button"
              aria-label={t('overlay.open-in-editor')}
              title={t('overlay.open-in-editor')}
              onClick={() => {
                const name = selectedPath.split(/[\\/]/).filter(Boolean).pop() ?? selectedPath
                sidebar.openTab({ resource: selectedPath, title: name, type: 'file' })
              }}
            ><IconExternalLink size={14} /></button>
          }
        >
          {previewLoading && <div className="oh-dsh-side-muted">{t('overlay.loading')}</div>}
          {!previewLoading && previewError !== '' && (
            <div className="oh-dsh-side-error" role="alert">{previewError}</div>
          )}
          {!previewLoading && preview !== null && (
            <ContentViewer
              path={selectedPath}
              content={preview.binary ? null : preview.content}
              binary={preview.binary}
              {...(preview.data === undefined ? {} : { data: preview.data })}
              t={t}
              onOpenExternal={() => {
                const name = selectedPath.split(/[\\/]/).filter(Boolean).pop() ?? selectedPath
                sidebar.openTab({ resource: selectedPath, title: name, type: 'file' })
              }}
            />
          )}
        </DetachedPanel>
      )}
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
   everything else is added through the [+] menu. */
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
      <button
        type="button"
        role="tab"
        aria-selected={activeType === 'files'}
        onClick={() => { openType('files') }}
      ><ToolIcon kind="files" />{t('files')}</button>
      <button
        type="button"
        role="tab"
        aria-selected={activeType === 'review'}
        onClick={() => { openType('review') }}
      ><ToolIcon kind="review" />{t('side.git')}</button>
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

function TabStrip({ sidebar, t }: {
  sidebar: DesktopSidebar
  t: Translate<WorkspaceMessage>
}): JSX.Element | null {
  const snapshot = useSyncExternalStore(sidebar.subscribe, sidebar.getSnapshot)
  if (snapshot.tabs.length < 2) return null
  return (
    <div className="oh-dsh-side-tabs" role="tablist">
      {snapshot.tabs.map(tab => (
        <div key={tab.id} data-active={tab.id === snapshot.activeId || undefined}>
          <button
            type="button"
            role="tab"
            aria-selected={tab.id === snapshot.activeId}
            title={tab.title}
            onClick={() => { sidebar.activateTab(tab.id) }}
          >{tab.title}</button>
          <button
            type="button"
            aria-label={t('side.close-named-tab', { title: tab.title })}
            onClick={() => { sidebar.closeTab(tab.id) }}
          ><IconClose size={12} /></button>
        </div>
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
      {activeTab !== undefined && descriptor?.chrome !== 'custom' && (
        <header className="oh-dsh-workspace-header oh-dsh-side-header">
          <div>
            <button
              type="button"
              aria-label={props.t('side.back')}
              onClick={() => { props.sidebar.activateTab(null) }}
            ><IconArrowLeft size={16} /></button>
            <strong>{title}</strong>
          </div>
          <div>
            <button
              type="button"
              aria-label={props.t('side.close-tab')}
              onClick={() => { props.sidebar.closeTab(activeTab.id) }}
            ><IconMinus size={16} /></button>
            <button
              type="button"
              aria-label={props.maximized ? props.t('side.restore') : props.t('side.expand')}
              title={props.maximized ? props.t('side.restore') : props.t('side.expand')}
              aria-pressed={props.maximized}
              onClick={props.onToggleMaximized}
            >{props.maximized ? <IconRestore size={16} /> : <IconExpand size={16} />}</button>
            <button
              type="button"
              aria-label={props.t('side.close')}
              onClick={props.onClose}
            ><IconClose size={16} /></button>
          </div>
        </header>
      )}
      {content}
    </aside>
  )
}
