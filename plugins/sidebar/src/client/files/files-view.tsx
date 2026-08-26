/**
 * The files surfaces of the desktop side panel (B1 split): `FilesView` is
 * the workspace explorer tree + search + inline create/rename/copy/delete;
 * `FileView` is the single-file viewer host. Both are composed from the
 * cohesive pieces under ./ (FilesTree, FilesSearch, FileActions,
 * FileViewHost). Extracted verbatim from SideToolsPanel.tsx — behavior
 * unchanged.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@dsh-studio/shared/i18n'
import {
  IconFilePlus,
  IconFolderPlus,
  IconPlus,
  IconRefresh,
} from '@dsh-studio/shared/tabler-icons'
import { basename, dirname, joinPath, relativePathOf, resolveCapabilitiesPath } from '@dsh-studio/shared/path'
import { EmptyState, ToolbarAction, useMenuAnchor } from '@dsh-studio/shared/ui'
import { alertDialog } from '../kit/dialog.tsx'
import type { OpenIntent } from '@dsh-studio/shared/workbench-contracts'
import { errorMessage } from '@dsh-studio/shared/errors'
import type { WorkspaceFileEntry } from '../../protocol.ts'
import { sidebarApi } from '../sidebar-api.ts'
import {
  getExplorerRuntime,
  sidebarScopeKey,
} from '../runtimes/registry.ts'
import { useSidebarChromeStore } from '../runtimes/chrome-store.ts'
import { workbenchOpen } from '../open/pipeline.ts'
import type {
  DesktopSidebarService,
  SidebarRenderProps,
} from '../contract.ts'
import type { ReviewCommentsService } from '../review/review-comments.ts'
import type { WorkspaceMessage } from '../i18n.ts'
import { SidebarSurfaceCss as surfaceCss } from '../styles.js'
import { buildFileRows } from './file-tree-model.ts'
import { FilesTree, type InlineCreatePending } from './files-tree.tsx'
import { FilesSearch, useFileSearch } from './files-search.tsx'
import { useFileActions } from './file-actions.ts'
import { FileViewHost } from './file-view-host.tsx'

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

  // Refresh listings. With an affected absolute path this invalidates ONLY
  // the affected parent directory subtree (D20c) instead of clearing every
  // cached directory — deep trees stop repainting on an unrelated rename.
  // Without a path (the explicit refresh button) every cached listing reloads.
  // `affectedPath` IS the changed directory (every caller passes the create
  // parent or dirname(target)); taking dirname here again escaped the
  // workspace for root-level ops, whose key filter then matched nothing and
  // left the tree stale until a manual refresh.
  const refreshListings = useCallback((affectedPath?: string): void => {
    if (runtime === null || cwd === undefined) return
    let keys: string[]
    if (affectedPath === undefined) {
      keys = [...runtime.getListingsSnapshot().keys()]
    } else {
      const relativeParent = relativePathOf(cwd, affectedPath)
      const prefix = relativeParent === '' ? '' : `${relativeParent}/`
      keys = [...runtime.getListingsSnapshot().keys()]
        .filter(key => key === relativeParent || key.startsWith(prefix))
    }
    void Promise.all(keys.map(key => runtime.refresh(key)))
  }, [cwd, runtime])

  const search = useFileSearch(scope, cwd)
  const { renameFsEntry, deleteFsEntry, copyFsEntry } = useFileActions({
    cwd,
    scope,
    selectedPath,
    active,
    t,
    refreshListings,
  })

  // Header [+] dropdown (official Menu, portaled; the trigger button keeps
  // aria-expanded so the CSS can show the pressed state).
  const {
    open: createMenuOpen,
    setOpen: setCreateMenuOpen,
    anchorRef: createButtonRef,
    getAnchorRect,
  } = useMenuAnchor()
  // Inline create editor row state (parent directory + entry kind).
  const [inlineCreate, setInlineCreate] = useState<InlineCreatePending | null>(null)

  // Tree mode expands from the workspace root; ensureListing short-circuits
  // on Ready/Empty — revisiting after a tab switch costs zero network.
  useEffect(() => {
    if (runtime === null || cwd === undefined) return
    void runtime.ensureListing(null)
  }, [cwd, runtime])

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
    workbenchOpen().open({ kind: 'file', target: { cwd, path: filePath }, intent, title: name })
  }

  // Inline creation: open an editor row at the top of `parent` (expanding the
  // directory first when it is collapsed) instead of asking through a dialog.
  const beginInlineCreate = async (kind: 'file' | 'directory', parent: string): Promise<void> => {
    if (cwd === undefined || scope == null) return
    search.setSearchQuery('')
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
      refreshListings(pending.parent)
    } catch (cause) {
      setInlineCreate(null)
      await alertDialog({
        title: t('files.op-failed'),
        message: errorMessage(cause),
        confirmLabel: t('dialog.ok'),
      })
    }
  }

  const cancelInlineCreate = (): void => {
    setInlineCreate(null)
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

  if (cwd === undefined) {
    return <EmptyState className={surfaceCss["dsh-studio-side-empty"]} title={t('files.select-workspace')} />
  }
  return (
    <div className={surfaceCss["dsh-studio-files-view"]}>
      <div className={surfaceCss["dsh-studio-files-path"]} title={cwd}>
        <span className={surfaceCss["dsh-studio-files-path-name"]}>{basename(cwd)}</span>
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
          onClick={() => { refreshListings() }}
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
      <FilesSearch
        cwd={cwd}
        query={search.searchQuery}
        hits={search.searchHits}
        error={search.searchError}
        searching={search.searching}
        onQueryChange={search.setSearchQuery}
        t={t}
      />
      <FilesTree
        cwd={cwd}
        scopeKey={scopeKey ?? cwd}
        t={t}
        rows={rows}
        loading={loading}
        error={error}
        inlineCreate={inlineCreate}
        onCommitInlineCreate={commitInlineCreate}
        onCancelInlineCreate={cancelInlineCreate}
        onToggleDirectory={toggleDirectory}
        onOpenFile={openFileInCenter}
        onBeginInlineCreate={beginInlineCreate}
        refreshListings={refreshListings}
        renameFsEntry={renameFsEntry}
        copyFsEntry={copyFsEntry}
        deleteFsEntry={deleteFsEntry}
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
  void reviewComments
  const cwd = scope?.cwd
  const path = tab.resource
  return (
    <FileViewHost
      cwd={cwd}
      path={path}
      title={tab.title}
      scope={scope}
      sidebar={sidebar}
      t={t}
      onOpenPath={onOpenPath}
    />
  )
}