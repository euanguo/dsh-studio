/**
 * The workspace Git Review panel: changes list, commit history with line
 * comments, branch/commit/push controls, and background-process mirror.
 * Extracted from plugin.tsx (single-file assembly) into its own module.
 */
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react'
import type {
  WorkspaceChange,
  WorkspaceFacts,
  WorkspaceMutation,
  WorkspaceSnapshot,
} from '../protocol.ts'
import type { Translate } from '@oh-dsh/shared/i18n'
import { basename } from '@oh-dsh/shared/path'
import { copyText } from '@oh-dsh/shared/copy-text'
import { runPanelMutation } from './source-control/panel-mutations.ts'
import { toast } from '@oh-dsh/shared/toast'
import { EmptyView, ErrorView, LoadingView } from './kit/status.tsx'
import { confirmDialog } from './kit/dialog.tsx'
import {
  IconBranch,
  IconChevronDown,
  IconHistory,
  IconPlus,
} from '@oh-dsh/shared/icons'
import {
  FileGlyph,
  IconChevronRight,
  IconEye,
  IconGitCommit,
} from '@oh-dsh/shared/tabler-icons'
import { FilenameLabel } from '@oh-dsh/shared/filename-label'
import type { WorkspaceMessage } from './i18n.ts'
import {
  sidebarApi,
  type SidebarGitCommitFile,
  type SidebarGitLogEntry,
  type SidebarScope,
} from './sidebar-api.ts'
import {
  type SessionsService,
  type WorkspaceTools,
  type WorkspacesService,
} from './client-types.ts'
import {
  ReviewCommentsService,
} from './review/review-comments.ts'
import {
  SourceControlPanel,
  type SourceControlPendingAction,
} from './source-control/source-control-panel.tsx'
import {
  ListRow,
  ListRowActionButton,
  ListRowBody,
  ListRowLabel,
  ListRowLabelText,
  ListRowLeading,
  ListRowMain,
  ListRowTrailing,
} from '@oh-dsh/shared/list-row'
import { Scrollable } from '@oh-dsh/shared/scrollable'
import {
  buildSourceControlRows,
  type SourceControlListMode,
  type SourceControlVisibleRow,
} from './source-control/source-control-view-model.ts'
import type { SourceControlSectionId } from './source-control/source-control-tree.ts'
import {
  buildSourceControlTree,
  flattenSourceControlTree,
} from './source-control/source-control-tree.ts'
import {
  getSourceControlRuntime,
  sidebarScopeKey,
} from './runtimes/registry.ts'
import { useSidebarChromeStore } from './runtimes/chrome-store.ts'
import { useCenterSurfaceStore } from './surfaces/center-surface-store.ts'

/** Commit history panel resizer bounds (px). */
const HISTORY_HEIGHT_DEFAULT = 256
const HISTORY_HEIGHT_MIN = 96
const HISTORY_HEIGHT_MAX = 520
/** Change rows rendered before the "more changes" notice. */
const VISIBLE_CHANGES_LIMIT = 200

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Lazy-loaded file list for one expanded history row. */
type CommitFilesState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; entries: readonly SidebarGitCommitFile[] }

/** The committed-changes projection (files in local commits ahead of the
 *  branch upstream). `none` = no upstream to compare against. */
type CommittedState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; baseRef: string; entries: readonly SidebarGitCommitFile[] }

function commitFileName(path: string): string {
  return basename(path)
}

function commitFileStatusWord(status: string): string {
  if (status === 'A') return 'added'
  if (status === 'D') return 'deleted'
  if (status === 'R') return 'renamed'
  if (status === 'C') return 'copied'
  return 'modified'
}

type CommitFileRow =
  | { kind: 'file'; key: string; path: string; status: string; additions: number; deletions: number; depth: number }
  | { kind: 'directory'; key: string; name: string; depth: number; fileCount: number; expanded: boolean }

/** Build the visible commit-file row stream, following the change list's
 *  flat/tree mode (directory grouping is re-used from the source-control
 *  tree model so both lists indent identically). */
function commitFileRows(
  files: readonly SidebarGitCommitFile[],
  mode: SourceControlListMode,
  collapsedDirs: ReadonlySet<string>,
  keyPrefix: string,
): CommitFileRow[] {
  if (mode === 'flat') {
    return files.map(file => ({
      kind: 'file',
      key: `file:${file.path}`,
      path: file.path,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      depth: 0,
    }))
  }
  const fileByPath = new Map(files.map(file => [file.path, file] as const))
  // The tree builder only reads `path`; the real status/counts are looked up
  // on render from the commit-file entries.
  const changes: WorkspaceChange[] = files.map(file => ({
    path: file.path,
    oldPath: null,
    status: 'modified',
    staged: false,
    additions: 0,
    deletions: 0,
  }))
  const tree = buildSourceControlTree(changes)
  const rows: CommitFileRow[] = []
  for (const node of flattenSourceControlTree(tree, collapsedDirs, keyPrefix)) {
    if (node.kind === 'file') {
      const file = fileByPath.get(node.path)
      rows.push({
        kind: 'file',
        key: node.key,
        path: node.path,
        status: file?.status ?? 'M',
        additions: file?.additions ?? 0,
        deletions: file?.deletions ?? 0,
        depth: node.depth,
      })
    } else {
      rows.push({
        kind: 'directory',
        key: node.key,
        name: node.name,
        depth: node.depth,
        fileCount: node.fileCount,
        expanded: !collapsedDirs.has(keyPrefix + node.key),
      })
    }
  }
  return rows
}

/** The inline file list under an expanded history row (orca parity): click a
 *  file → its single diff in the center; the commit row's own "view all"
 *  icon opens the whole-commit diff instead. `nested` marks rows that live
 *  under a commit row (extra chevron-column indent); the committed-changes
 *  section passes nested=false so its rows align with the change list. */
function CommitFilesBody({
  state,
  mode,
  collapsedDirs,
  onToggleDir,
  onOpenFile,
  t,
  keyPrefix,
  nested = true,
}: {
  state: CommitFilesState | undefined
  mode: SourceControlListMode
  collapsedDirs: ReadonlySet<string>
  onToggleDir(key: string): void
  onOpenFile(path: string): void
  t: Translate<WorkspaceMessage>
  keyPrefix: string
  nested?: boolean
}): JSX.Element {
  if (state === undefined || state.status === 'loading') {
    return (
      <div className="oh-dsh-review-commit-files">
        <LoadingView label={t('overlay.loading')} />
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="oh-dsh-review-commit-files">
        <ErrorView message={state.error} />
      </div>
    )
  }
  if (state.entries.length === 0) {
    return (
      <div className="oh-dsh-review-commit-files">
        <EmptyView title={t('workspace.commit-no-files')} />
      </div>
    )
  }
  const rows = commitFileRows(state.entries, mode, collapsedDirs, keyPrefix)
  const sectionModifier = nested ? '' : ' is-section'
  return (
    <div className="oh-dsh-review-commit-files">
      {rows.map(row => row.kind === 'directory' ? (
        <button
          key={row.key}
          type="button"
          className={`oh-dsh-review-commit-dir${sectionModifier}`}
          style={{ '--tree-depth': row.depth } as CSSProperties}
          onClick={() => { onToggleDir(row.key) }}
        >
          {row.expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          <span className="oh-dsh-review-commit-dir-name">{row.name}</span>
          <span className="oh-dsh-workspace-count">{row.fileCount}</span>
        </button>
      ) : (
        <button
          key={row.key}
          type="button"
          className={`oh-dsh-review-commit-file${sectionModifier}`}
          title={row.path}
          style={{ '--tree-depth': row.depth } as CSSProperties}
          onClick={() => { onOpenFile(row.path) }}
        >
          <FileGlyph path={row.path} kind="file" />
          <FilenameLabel name={commitFileName(row.path)} title={row.path} />
          {(row.additions > 0 || row.deletions > 0) && (
            <span className="oh-dsh-sc-stat" aria-hidden="true">
              {row.additions > 0 && <em className="oh-dsh-sc-stat-add">+{row.additions}</em>}
              {row.deletions > 0 && <em className="oh-dsh-sc-stat-del">−{row.deletions}</em>}
            </span>
          )}
          <span className={`oh-dsh-sc-mark is-${commitFileStatusWord(row.status)}`}>
            {row.status === 'T' ? 'M' : row.status}
          </span>
        </button>
      ))}
    </div>
  )
}

export function WorkspacePanel({
  reviewComments,
  service,
  sessions,
  workspaces,
  t,
}: {
  reviewComments: ReviewCommentsService
  service: WorkspaceTools
  sessions: SessionsService
  workspaces: WorkspacesService
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const panelState = useSyncExternalStore(service.subscribe, service.getSnapshot)
  const sessionList = useSyncExternalStore(sessions.list.subscribe, sessions.list.getSnapshot)
  const sessionId = sessionList.current
  const cwd = sessionId === undefined ? undefined : sessionList.byId[sessionId]?.cwd
  // Retained source-control runtime: the git snapshot survives tab switches
  // (registry keeps the instance; ready data renders instantly).
  const runtime = useMemo(
    () => (sessionId === undefined || cwd === undefined
      ? null
      : getSourceControlRuntime({ sessionId, cwd })),
    [cwd, sessionId],
  )
  const runtimeFingerprint = useSyncExternalStore(
    useCallback((listener: () => void) => runtime?.subscribe(listener) ?? (() => {}), [runtime]),
    useCallback(() => runtime?.fingerprint() ?? 'none', [runtime]),
  )
  // The runtime snapshot is read during render; fingerprint changes re-render.
  void runtimeFingerprint
  const runtimeSnapshot = runtime?.getSnapshot() ?? null
  const snapshot = runtimeSnapshot?.snapshot ?? null
  const error = runtimeSnapshot?.phase === 'error' ? (runtimeSnapshot.message ?? '') : ''
  const history = snapshot?.history ?? []
  const [busy, setBusy] = useState(false)
  const scopeKey = sessionId === undefined || cwd === undefined
    ? null
    : sidebarScopeKey({ sessionId, cwd })
  const chrome = useSidebarChromeStore(state =>
    scopeKey === null ? null : state.getSlice(scopeKey))
  const collapsedSections = useMemo(
    () => new Set(chrome?.sourceControl.collapsedSections ?? []) as ReadonlySet<SourceControlSectionId>,
    [chrome?.sourceControl.collapsedSections],
  )
  const collapsedDirectories = useMemo(
    () => new Set(chrome?.sourceControl.collapsedDirectories ?? []),
    [chrome?.sourceControl.collapsedDirectories],
  )
  const listMode: SourceControlListMode = chrome?.gitListMode ?? 'tree'
  const selectedPath = chrome?.sourceControl.selectedPath ?? null
  const [pendingByPath, setPendingByPath] = useState<ReadonlyMap<string, SourceControlPendingAction>>(new Map())
  const [newBranch, setNewBranch] = useState('')
  // Expanded history row + its lazily-loaded file list (per commit hash).
  const [expandedCommitId, setExpandedCommitId] = useState<string | null>(null)
  const [commitFiles, setCommitFiles] = useState<ReadonlyMap<string, CommitFilesState>>(new Map())
  // Collapsed directory keys for the inline commit file lists (prefixed by
  // commit hash so the same directory path can stay open in different commits).
  const [collapsedCommitDirs, setCollapsedCommitDirs] = useState<ReadonlySet<string>>(new Set())
  const toggleCommitDir = (key: string): void => {
    setCollapsedCommitDirs(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  // Committed changes (files in local commits ahead of the branch upstream).
  const [committed, setCommitted] = useState<CommittedState>({ status: 'none' })
  const [committedCollapsed, setCommittedCollapsed] = useState(false)
  const [collapsedCommittedDirs, setCollapsedCommittedDirs] = useState<ReadonlySet<string>>(new Set())
  const toggleCommittedDir = (key: string): void => {
    setCollapsedCommittedDirs(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  // Git history docks at the bottom collapsed by default; when expanded it
  // keeps a bounded height (drag the top edge to resize) instead of pushing
  // the change list out of view (orca parity).
  const [historyCollapsed, setHistoryCollapsed] = useState(true)
  const [historyHeight, setHistoryHeight] = useState(HISTORY_HEIGHT_DEFAULT)
  const historyResizeRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const historyResizeCleanupRef = useRef<(() => void) | null>(null)
  const startHistoryResize = useCallback((event: React.PointerEvent): void => {
    event.preventDefault()
    historyResizeRef.current = { startY: event.clientY, startHeight: historyHeight }
    const onMove = (move: PointerEvent): void => {
      const session = historyResizeRef.current
      if (session === null) return
      const next = session.startHeight + session.startY - move.clientY
      setHistoryHeight(Math.min(HISTORY_HEIGHT_MAX, Math.max(HISTORY_HEIGHT_MIN, next)))
    }
    const onUp = (): void => {
      historyResizeRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      historyResizeCleanupRef.current = null
    }
    historyResizeCleanupRef.current = onUp
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    // Pointer capture can drop mid-drag (window blur, gesture takeover).
    window.addEventListener('pointercancel', onUp)
  }, [historyHeight])
  // If the panel unmounts mid-drag the window listeners above would leak.
  useEffect(() => () => {
    historyResizeCleanupRef.current?.()
  }, [])
  // Draft commit message lives in the chrome store (persisted per scope) so it
  // survives tab switches and reloads.
  const commitMessage = chrome?.sourceControl.commitMessage ?? ''
  const setCommitMessage = (message: string): void => {
    if (scopeKey !== null) {
      useSidebarChromeStore.getState().setSourceControlCommitMessage(scopeKey, message)
    }
  }
  const visibleChanges = snapshot?.changes.slice(0, VISIBLE_CHANGES_LIMIT) ?? []
  const rows = useMemo<SourceControlVisibleRow[]>(
    () => buildSourceControlRows({
      changes: visibleChanges,
      collapsedSections,
      collapsedDirectories,
      selectedPath,
      mode: listMode,
    }),
    [collapsedDirectories, collapsedSections, listMode, selectedPath, visibleChanges],
  )
  const scope = useMemo<SidebarScope | undefined>(
    () => sessionId === undefined || cwd === undefined
      ? undefined
      : { sessionId, cwd },
    [cwd, sessionId],
  )
  const branch = snapshot?.branch ?? null

  const refresh = useCallback(async (): Promise<void> => {
    if (runtime === null) return
    await runtime.refresh()
  }, [runtime])

  const refreshCommitted = useCallback(async (): Promise<void> => {
    if (scope === undefined) return
    try {
      const result = await sidebarApi.gitCommittedFiles(scope)
      if (result.baseRef === null) {
        setCommitted({ status: 'none' })
        return
      }
      setCommitted({ status: 'ready', baseRef: result.baseRef, entries: result.entries })
    } catch (cause) {
      setCommitted({ status: 'error', error: errorMessage(cause) })
    }
  }, [scope])

  useEffect(() => {
    if (!panelState.open || panelState.view !== 'review' || runtime === null) return
    void runtime.ensureLoaded()
    void refreshCommitted()
    // Soft-revalidate on a 4s cadence while the review panel is open, but
    // never while the document is hidden (backgrounded window / another
    // tab) — the focus listener below covers the return to visibility.
    const timer = window.setInterval(() => {
      if (document.hidden) return
      void runtime.refresh()
      void refreshCommitted()
    }, 4_000)
    const onFocus = (): void => {
      void runtime.refresh()
      void refreshCommitted()
    }
    const onVisibility = (): void => {
      if (!document.hidden) {
        void runtime.refresh()
        void refreshCommitted()
      }
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [panelState.open, panelState.view, runtime, refreshCommitted])

  useEffect(() => {
    setExpandedCommitId(null)
    setCommitFiles(new Map())
    setCollapsedCommitDirs(new Set())
    setCommitted({ status: 'none' })
    setCommittedCollapsed(false)
    setCollapsedCommittedDirs(new Set())
  }, [cwd])

  // Clicking a history row toggles its inline file list (lazy-loaded, orca
  // parity) instead of jumping straight to the whole-commit diff.
  const toggleCommitFiles = (entry: SidebarGitLogEntry): void => {
    if (scope === undefined) return
    const hash = entry.hashFull
    const loaded = commitFiles.has(hash)
    setExpandedCommitId(current => current === hash ? null : hash)
    if (loaded) return
    setCommitFiles(current => new Map(current).set(hash, { status: 'loading' }))
    void sidebarApi.gitCommitFiles(scope, hash).then(entries => {
      setCommitFiles(current => new Map(current).set(hash, { status: 'ready', entries }))
    }).catch((cause: unknown) => {
      setCommitFiles(current => new Map(current).set(hash, { status: 'error', error: errorMessage(cause) }))
    })
  }

  // The commit row's "view all" icon → whole-commit diff in the center.
  const openCommitDiffInCenter = (entry: SidebarGitLogEntry): void => {
    if (cwd === undefined) return
    useCenterSurfaceStore.getState().openCommit({
      sessionId: sessionId ?? '',
      cwd,
      hash: entry.hashFull,
      title: entry.subject || entry.hash,
      preview: true,
    })
  }

  // A file in a commit's inline list → that single file's diff in the center.
  const openCommitFileInCenter = (entry: SidebarGitLogEntry, filePath: string): void => {
    if (cwd === undefined) return
    useCenterSurfaceStore.getState().openCommitFile({
      sessionId: sessionId ?? '',
      cwd,
      hash: entry.hashFull,
      filePath,
      preview: true,
    })
  }

  // Committed changes: "view all" → whole projection; a file → its diff.
  const openCommittedAllInCenter = (baseRef: string): void => {
    if (cwd === undefined) return
    useCenterSurfaceStore.getState().openCommitted({
      sessionId: sessionId ?? '',
      cwd,
      baseRef,
      preview: true,
    })
  }

  const openCommittedFileInCenter = (baseRef: string, filePath: string): void => {
    if (cwd === undefined) return
    useCenterSurfaceStore.getState().openCommitted({
      sessionId: sessionId ?? '',
      cwd,
      baseRef,
      filePath,
      preview: true,
    })
  }

  useEffect(() => {
    if (cwd === undefined || branch === null) return
    reviewComments.activate(sessionId ?? null, cwd, branch)
  }, [branch, cwd, reviewComments, sessionId])

  const mutate = async (mutation: WorkspaceMutation): Promise<void> => {
    if (cwd === undefined || scope === undefined || busy) return
    setBusy(true)
    try {
      await runPanelMutation(mutation, {
        scope,
        cwd,
        t,
        onCommitted: () => { setCommitMessage('') },
        refresh,
        reportError: message => { runtime?.reportError(message) },
      })
    } finally {
      setBusy(false)
    }
  }

  const openDiffInCenter = (path: string, preview: boolean): void => {
    if (cwd === undefined || scopeKey === null) return
    const name = basename(path)
    const change = snapshot?.changes.find(candidate => candidate.path === path)
    useSidebarChromeStore.getState().setSourceControlSelectedPath(scopeKey, path)
    // Single click = preview diff tab; double click = pinned diff tab.
    // Untracked files have no diff baseline — show the file content
    // instead of an empty "no diff" error.
    if (change === undefined || change.status === 'untracked') {
      useCenterSurfaceStore.getState().openFile({ sessionId: sessionId ?? '', cwd, filePath: path, title: name, preview })
      return
    }
    // Conflicted entries (UU/AA/DD) open the merge-conflict resolver.
    if (change.status === 'conflicted') {
      useCenterSurfaceStore.getState().openConflict({ sessionId: sessionId ?? '', cwd, filePath: path, title: name, preview })
      return
    }
    useCenterSurfaceStore.getState().openDiff({ sessionId: sessionId ?? '', cwd, filePath: path, staged: change.staged, title: name, preview })
  }

  const viewAllInCenter = (id: SourceControlSectionId): void => {
    if (cwd === undefined || sessionId === undefined) return
    const staged = id === 'staged'
    useCenterSurfaceStore.getState().openDiffAll({
      sessionId,
      cwd,
      staged,
      title: staged ? t('source-control.section.staged') : t('source-control.section.unstaged'),
      preview: true,
    })
  }

  const runPaths = async (
    action: SourceControlPendingAction,
    paths: readonly string[],
  ): Promise<void> => {
    if (scope === undefined || paths.length === 0) return
    const pending = new Map(pendingByPath)
    for (const path of paths) pending.set(path, action)
    setPendingByPath(pending)
    try {
      if (action === 'stage') await sidebarApi.gitStage(scope, paths)
      else if (action === 'unstage') await sidebarApi.gitUnstage(scope, paths)
      else await sidebarApi.gitDiscard(scope, paths)
      if (action === 'discard') toast('success', t('toast.discarded'))
      await refresh()
    } catch (nextError) {
      runtime?.reportError(errorMessage(nextError))
    } finally {
      setPendingByPath(new Map())
    }
  }

  const requestDiscard = async (paths: readonly string[], label: string): Promise<void> => {
    const confirmed = await confirmDialog({
      title: t('source-control.discard'),
      message: t('source-control.discard-confirm', { paths: label }),
      confirmLabel: t('source-control.discard'),
      cancelLabel: t('dialog.cancel'),
      danger: true,
    })
    if (confirmed) void runPaths('discard', paths)
  }

  const copyPath = (path: string): void => {
    void copyText(path).then(ok => {
      toast(ok ? 'success' : 'error', ok ? t('toast.copied') : t('toast.copy-failed'))
    })
  }

  const chooseWorkspace = async (): Promise<void> => {
    const paths = await window.dshDesktop?.chooseWorkspace() ?? []
    for (const path of paths) {
      const workspace = await workspaces.create({ path })
      workspaces.startSession(workspace.workspaceId)
    }
  }

  return (
    <div className="oh-dsh-review-view" aria-label={t('workspace.changes')}>
      {cwd === undefined
        ? <EmptyView title={t('workspace.select')} />
        : (
          <>
            <Scrollable className="oh-dsh-workspace-content">
            {error !== '' && <ErrorView message={error} />}

            {/* Commit area rides the top (orca parity): branch + message +
                commit/push stay visible above the change list instead of
                hiding behind a bottom fold. */}
            {snapshot?.kind === 'repository' && (
              <section className="oh-dsh-commit-area">
                <label className="oh-dsh-workspace-fact">
                  <span className="oh-dsh-workspace-fact-icon"><IconBranch size={16} /></span>
                  <select
                    value={snapshot?.branch ?? ''}
                    disabled={busy}
                    aria-label={t('workspace.current-branch')}
                    onChange={event => { void mutate({ action: 'checkout', branch: event.currentTarget.value }) }}
                  >
                    {(snapshot?.branches ?? []).map(branch => <option key={branch} value={branch}>{branch}</option>)}
                  </select>
                  <span className="oh-dsh-workspace-chevron"><IconChevronDown size={14} /></span>
                </label>
                <textarea
                  value={commitMessage}
                  placeholder={t('workspace.commit-message')}
                  aria-label={t('workspace.commit-message')}
                  onChange={event => { setCommitMessage(event.currentTarget.value) }}
                />
                <div className="oh-dsh-commit-actions">
                  <button
                    type="button"
                    disabled={busy || snapshot.changes.length === 0 || commitMessage.trim() === ''}
                    onClick={() => { void mutate({ action: 'commit', message: commitMessage }) }}
                  >{t('workspace.commit-all')}</button>
                  <button
                    type="button"
                    disabled={busy || !snapshot.hasRemote}
                    onClick={() => { void mutate({ action: 'push' }) }}
                  >{t('workspace.push')}{snapshot.ahead > 0 ? ` (${String(snapshot.ahead)})` : ''}</button>
                </div>
                {snapshot.behind > 0 && (
                  <small>{t('workspace.behind', { count: snapshot.behind })}</small>
                )}
              </section>
            )}

            <section>
              <div className="oh-dsh-change-list">
                <SourceControlPanel
                  rows={rows}
                  pendingByPath={pendingByPath}
                  mode={listMode}
                  count={snapshot?.changes.length ?? 0}
                  t={t}
                  onModeChange={mode => {
                    if (scopeKey !== null) {
                      useSidebarChromeStore.getState().setGitListMode(scopeKey, mode)
                    }
                  }}
                  onToggleSection={id => {
                    if (scopeKey !== null) {
                      useSidebarChromeStore.getState().toggleSourceControlSection(scopeKey, id)
                    }
                  }}
                  onToggleDirectory={key => {
                    if (scopeKey !== null) {
                      useSidebarChromeStore.getState().toggleSourceControlDirectory(scopeKey, key)
                    }
                  }}
                  onSelectFile={path => { openDiffInCenter(path, true) }}
                  onOpenFile={path => { openDiffInCenter(path, false) }}
                  onStage={paths => { void runPaths('stage', paths) }}
                  onUnstage={paths => { void runPaths('unstage', paths) }}
                  onDiscard={requestDiscard}
                  onViewAll={viewAllInCenter}
                  onCopyPath={copyPath}
                />
                {(snapshot?.changes.length ?? 0) > visibleChanges.length && (
                  <EmptyView
                    title={t('workspace.more-changes', {
                      count: (snapshot?.changes.length ?? 0) - visibleChanges.length,
                    })}
                  />
                )}
                {snapshot?.kind === 'repository' && snapshot.changes.length === 0 && (
                  <EmptyView title={t('workspace.clean')} />
                )}
                {snapshot?.kind === 'directory' && (
                  <EmptyView title={t('workspace.not-git')} />
                )}
              </div>
            </section>

            {snapshot?.kind === 'repository' && committed.status === 'ready' && committed.entries.length > 0 && (
              <section className="oh-dsh-committed-section">
                <div
                  className="oh-dsh-sc-toolbar oh-dsh-committed-header"
                  role="button"
                  tabIndex={0}
                  aria-expanded={!committedCollapsed}
                  onClick={() => { setCommittedCollapsed(collapsed => !collapsed) }}
                >
                  <span className="oh-dsh-sc-toolbar-title">
                    <IconGitCommit size={14} />
                    {t('workspace.committed')}
                    <em>{committed.entries.length}</em>
                  </span>
                  <span className="oh-dsh-committed-actions">
                    <ListRowActionButton
                      aria-label={t('source-control.view-all')}
                      title={t('source-control.view-all')}
                      onClick={event => {
                        event.stopPropagation()
                        openCommittedAllInCenter(committed.baseRef)
                      }}
                    ><IconEye size={14} /></ListRowActionButton>
                    <IconChevronDown
                      size={14}
                      className={committedCollapsed ? 'oh-dsh-history-chevron is-collapsed' : 'oh-dsh-history-chevron'}
                    />
                  </span>
                </div>
                {!committedCollapsed && (
                  <CommitFilesBody
                    state={{ status: 'ready', entries: committed.entries }}
                    mode={listMode}
                    collapsedDirs={collapsedCommittedDirs}
                    onToggleDir={toggleCommittedDir}
                    onOpenFile={path => { openCommittedFileInCenter(committed.baseRef, path) }}
                    t={t}
                    keyPrefix="committed:"
                    nested={false}
                  />
                )}
              </section>
            )}

            <section className="oh-dsh-workspace-facts">
              {snapshot?.kind === 'repository' && (
                <div className="oh-dsh-new-branch">
                  <input
                    value={newBranch}
                    placeholder={t('workspace.new-branch')}
                    aria-label={t('workspace.new-branch-name')}
                    onChange={event => { setNewBranch(event.currentTarget.value) }}
                  />
                  <button
                    type="button"
                    disabled={busy || newBranch.trim() === ''}
                    onClick={() => { void mutate({ action: 'create-branch', branch: newBranch }).then(() => { setNewBranch('') }) }}
                  >{t('workspace.create')}</button>
                </div>
              )}
            </section>

            <section className="oh-dsh-workspace-directory">
              <span>{snapshot?.name ?? basename(cwd)}</span>
              <small title={cwd}>{cwd}</small>
              <button type="button" onClick={() => { void chooseWorkspace() }} aria-label={t('workspace.add')}><IconPlus size={16} /></button>
            </section>
          </Scrollable>

          {snapshot?.kind === 'repository' && (
            <section className="oh-dsh-review-history">
              {!historyCollapsed && (
                <div
                  className="oh-dsh-history-resize"
                  role="separator"
                  aria-label={t('workspace.review-history')}
                  onPointerDown={startHistoryResize}
                />
              )}
              <div
                className="oh-dsh-sc-toolbar oh-dsh-history-toggle"
                role="button"
                tabIndex={0}
                aria-expanded={!historyCollapsed}
                onClick={() => { setHistoryCollapsed(collapsed => !collapsed) }}
              >
                <span className="oh-dsh-sc-toolbar-title">
                  <IconHistory size={14} />
                  {t('workspace.review-history')}
                  <em>{history.length}</em>
                </span>
                <IconChevronDown
                  size={14}
                  className={historyCollapsed ? 'oh-dsh-history-chevron is-collapsed' : 'oh-dsh-history-chevron'}
                />
              </div>
              {!historyCollapsed && (
                <Scrollable
                  className="oh-dsh-review-commit-list"
                  style={{ maxHeight: historyHeight }}
                >
                  {history.map(entry => {
                    const isExpanded = expandedCommitId === entry.hashFull
                    return (
                      <Fragment key={entry.hashFull}>
                        <ListRow
                          className="oh-dsh-review-commit-row"
                          selected={isExpanded}
                          title={entry.subject}
                        >
                          <ListRowMain
                            className="oh-dsh-sc-depth-main"
                            aria-expanded={isExpanded}
                            onClick={() => { toggleCommitFiles(entry) }}
                          >
                            <ListRowLeading aria-hidden="true">
                              {isExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                            </ListRowLeading>
                            <ListRowBody>
                              <ListRowLabel>
                                <ListRowLabelText>{entry.subject}</ListRowLabelText>
                              </ListRowLabel>
                            </ListRowBody>
                            <ListRowTrailing>
                              <span className="oh-dsh-review-commit-author">{entry.author}</span>
                              <code className="oh-dsh-review-commit-hash">{entry.hash}</code>
                            </ListRowTrailing>
                          </ListRowMain>
                          <ListRowTrailing>
                            <ListRowActionButton
                              aria-label={t('source-control.view-all')}
                              title={t('source-control.view-all')}
                              onClick={() => { openCommitDiffInCenter(entry) }}
                            ><IconEye size={14} /></ListRowActionButton>
                          </ListRowTrailing>
                        </ListRow>
                        {isExpanded && (
                          <CommitFilesBody
                            state={commitFiles.get(entry.hashFull)}
                            mode={listMode}
                            collapsedDirs={collapsedCommitDirs}
                            onToggleDir={toggleCommitDir}
                            onOpenFile={path => { openCommitFileInCenter(entry, path) }}
                            t={t}
                            keyPrefix={`commit:${entry.hashFull}:`}
                          />
                        )}
                      </Fragment>
                    )
                  })}
                  {history.length === 0 && (
                    <EmptyView title={t('workspace.no-commits')} />
                  )}
                </Scrollable>
              )}
            </section>
          )}
          </>
        )}
    </div>
  )
}
