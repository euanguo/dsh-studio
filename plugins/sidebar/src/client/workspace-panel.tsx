/**
 * The workspace Git Review panel: changes list, commit history with line
 * comments, branch/commit/push controls, and background-process mirror.
 * Extracted from plugin.tsx (single-file assembly) into its own module.
 */
import { SidebarSurfaceCss as surfaceCss } from './styles.js'
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
import type { Translate } from '@dsh-studio/shared/i18n'
import { basename } from '@dsh-studio/shared/path'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { runPanelMutation } from './source-control/panel-mutations.ts'
import { toast } from '@dsh-studio/shared/toast'
import { EmptyState, ErrorState, LoadingState } from '@dsh-studio/shared/ui'
import { confirmDialog } from './kit/dialog.tsx'
import {
  FileGlyph,
  IconChevronDown,
  IconChevronRight,
  IconEye,
  IconGitCommit,
  IconHistory,
} from '@dsh-studio/shared/tabler-icons'
import { FilenameLabel } from '@dsh-studio/shared/filename-label'
import type { WorkspaceMessage } from './i18n.ts'
import {
  sidebarApi,
  type CapabilitiesGitCommitFile,
  type CapabilitiesGitLogEntry,
  type CapabilitiesScope,
} from './sidebar-api.ts'
import {
  type SessionsService,
  type WorkspaceTools,
} from './client-types.ts'
import {
  ReviewCommentsService,
} from './review/review-comments.ts'
import {
  SourceControlPanel,
  type SourceControlPendingAction,
} from './source-control/source-control-panel.tsx'
import { CommitArea } from './source-control/commit-area.tsx'
import { resolveSourceControlActions } from './source-control/source-control-actions.ts'
import { useSourceControlActionController } from './source-control/source-control-action-controller.ts'
import {
  ListRow,
  ListRowActionButton,
  ListRowBody,
  ListRowLabel,
  ListRowLabelText,
  ListRowLeading,
  ListRowMain,
  ListRowTrailing,
} from '@dsh-studio/shared/ui'
import { ScrollArea } from '@dsh-studio/shared/ui'
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
import { openFileSurface, openDiffSurface, openConflictSurface, openDiffAllSurface, openCommitSurface, openCommitFileSurface, openCommittedSurface } from './open/pipeline.ts'

/** Commit history panel resizer bounds (px). */
const HISTORY_HEIGHT_DEFAULT = 256
const HISTORY_HEIGHT_MIN = 96
const HISTORY_HEIGHT_MAX = 520
/** Change rows rendered before the "more changes" notice. */
const VISIBLE_CHANGES_LIMIT = 200

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function actionLabelForConfirmation(
  kind: 'abort-merge' | 'abort-rebase',
  t: Translate<WorkspaceMessage>,
): string {
  return kind === 'abort-merge' ? t('workspace.commit-abort-merge') : t('workspace.commit-abort-rebase')
}

/** Lazy-loaded file list for one expanded history row. */
type CommitFilesState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; entries: readonly CapabilitiesGitCommitFile[] }

/** The committed-changes projection (files in local commits ahead of the
 *  branch upstream). `none` = no upstream to compare against. */
type CommittedState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; baseRef: string; entries: readonly CapabilitiesGitCommitFile[] }

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
  files: readonly CapabilitiesGitCommitFile[],
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
      <div className={surfaceCss["dsh-studio-review-commit-files"]}>
        <LoadingState label={t('overlay.loading')} />
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className={surfaceCss["dsh-studio-review-commit-files"]}>
        <ErrorState message={state.error} />
      </div>
    )
  }
  if (state.entries.length === 0) {
    return (
      <div className={surfaceCss["dsh-studio-review-commit-files"]}>
        <EmptyState title={t('workspace.commit-no-files')} />
      </div>
    )
  }
  const rows = commitFileRows(state.entries, mode, collapsedDirs, keyPrefix)
  const sectionModifier = nested ? '' : ' is-section'
  return (
    <div className={surfaceCss["dsh-studio-review-commit-files"]}>
      {rows.map(row => row.kind === 'directory' ? (
        <button
          key={row.key}
          type="button"
          className={`${surfaceCss["dsh-studio-review-commit-dir"]}${sectionModifier}`}
          style={{ '--tree-depth': row.depth } as CSSProperties}
          onClick={() => { onToggleDir(row.key) }}
        >
          {row.expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          <span className={surfaceCss["dsh-studio-review-commit-dir-name"]}>{row.name}</span>
          <span className="dsh-studio-workspace-count">{row.fileCount}</span>
        </button>
      ) : (
        <button
          key={row.key}
          type="button"
          className={`${surfaceCss["dsh-studio-review-commit-file"]}${sectionModifier}`}
          title={row.path}
          style={{ '--tree-depth': row.depth } as CSSProperties}
          onClick={() => { onOpenFile(row.path) }}
        >
          <FileGlyph path={row.path} kind="file" />
          <FilenameLabel name={commitFileName(row.path)} title={row.path} />
          {(row.additions > 0 || row.deletions > 0) && (
            <span className={surfaceCss["dsh-studio-sc-stat"]} aria-hidden="true">
              {row.additions > 0 && <em className={surfaceCss["dsh-studio-sc-stat-add"]}>+{row.additions}</em>}
              {row.deletions > 0 && <em className={surfaceCss["dsh-studio-sc-stat-del"]}>−{row.deletions}</em>}
            </span>
          )}
          <span className={`dsh-studio-sc-mark is-${commitFileStatusWord(row.status)}`}>
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
  t,
}: {
  reviewComments: ReviewCommentsService
  service: WorkspaceTools
  sessions: SessionsService
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const panelState = useSyncExternalStore(service.subscribe, service.getSnapshot)
  const sessionList = useSyncExternalStore(sessions.list.subscribe, sessions.list.getSnapshot)
  const currentSessionId = sessionList.current
  const cwd = currentSessionId === undefined ? undefined : sessionList.byId[currentSessionId]?.cwd
  // Retained source-control runtime: the git snapshot survives tab switches
  // (registry keeps the instance; ready data renders instantly).
  const runtime = useMemo(
    () => (cwd === undefined
      ? null
      : getSourceControlRuntime({ cwd })),
    [cwd],
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
  const [generatingCommitMessage, setGeneratingCommitMessage] = useState(false)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const scopeKey = cwd === undefined
    ? null
    : sidebarScopeKey({ cwd })
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
  const scope = useMemo<CapabilitiesScope | undefined>(
    () => cwd === undefined
      ? undefined
      : { cwd },
    [cwd],
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
  const refreshAfterAction = useCallback(async (): Promise<void> => {
    await Promise.all([refresh(), refreshCommitted()])
  }, [refresh, refreshCommitted])
  const actionController = useSourceControlActionController({
    scope,
    refresh: refreshAfterAction,
    onCommitted: () => { setCommitMessage('') },
  })
  const sourceControlActions = useMemo(() => resolveSourceControlActions({
    hasChanges: (snapshot?.changes.length ?? 0) > 0,
    hasUnresolvedConflicts: snapshot?.changes.some(change => change.status === 'conflicted') ?? false,
    hasMessage: commitMessage.trim() !== '',
    busy: actionController.state.phase === 'running',
    upstream: snapshot?.upstream,
  }), [actionController.state.phase, commitMessage, snapshot?.changes.length, snapshot?.upstream])

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
  const toggleCommitFiles = (entry: CapabilitiesGitLogEntry): void => {
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
  const openCommitDiffInCenter = (entry: CapabilitiesGitLogEntry): void => {
    if (cwd === undefined) return
    openCommitSurface({
      cwd,
      hash: entry.hashFull,
      title: entry.subject || entry.hash,
      intent: 'preview',
    })
  }

  // A file in a commit's inline list → that single file's diff in the center.
  const openCommitFileInCenter = (entry: CapabilitiesGitLogEntry, filePath: string): void => {
    if (cwd === undefined) return
    openCommitFileSurface({
      cwd,
      hash: entry.hashFull,
      filePath,
      title: filePath.split('/').pop() || filePath,
      intent: 'preview',
    })
  }

  // Committed changes: "view all" → whole projection; a file → its diff.
  const openCommittedAllInCenter = (baseRef: string): void => {
    if (cwd === undefined) return
    openCommittedSurface({
      cwd,
      baseRef,
      title: baseRef,
      intent: 'preview',
    })
  }

  const openCommittedFileInCenter = (baseRef: string, filePath: string): void => {
    if (cwd === undefined) return
    openCommittedSurface({
      cwd,
      baseRef,
      filePath,
      title: filePath.split('/').pop() || filePath,
      intent: 'preview',
    })
  }

  useEffect(() => {
    if (cwd === undefined || branch === null) return
    reviewComments.activate(cwd, branch)
  }, [branch, cwd, reviewComments])

  const mutate = async (mutation: WorkspaceMutation): Promise<void> => {
    if (cwd === undefined || scope === undefined || actionController.state.phase === 'running') return
    await runPanelMutation(mutation, {
      scope,
      cwd,
      t,
      onCommitted: () => { setCommitMessage('') },
      refresh: refreshAfterAction,
      reportError: message => { runtime?.reportError(message) },
    })
  }

  const generateCommitMessage = async (): Promise<void> => {
    if (scope === undefined || generatingCommitMessage) return
    setGeneratingCommitMessage(true)
    setGenerationError(null)
    try {
      const result = await sidebarApi.gitGenerateCommitMessage(scope)
      setCommitMessage(result.message)
    } catch (cause) {
      setGenerationError(errorMessage(cause))
    } finally {
      setGeneratingCommitMessage(false)
    }
  }

  const cancelCommitMessageGeneration = (): void => {
    if (scope !== undefined) void sidebarApi.gitCancelGenerateCommitMessage(scope)
    setGeneratingCommitMessage(false)
  }

  const openDiffInCenter = (path: string, intent: 'preview' | 'pin'): void => {
    if (cwd === undefined || scopeKey === null) return
    const name = basename(path)
    const change = snapshot?.changes.find(candidate => candidate.path === path)
    useSidebarChromeStore.getState().setSourceControlSelectedPath(scopeKey, path)
    // Single click = preview diff tab; double click = pinned diff tab.
    // Untracked files have no diff baseline — show the file content
    // instead of an empty "no diff" error.
    if (change === undefined || change.status === 'untracked') {
      openFileSurface({ cwd, filePath: path, title: name, intent })
      return
    }
    // Conflicted entries (UU/AA/DD) open the merge-conflict resolver.
    if (change.status === 'conflicted') {
      openConflictSurface({ cwd, filePath: path, title: name, intent })
      return
    }
    openDiffSurface({ cwd, filePath: path, staged: change.staged, title: name, intent })
  }

  const viewAllInCenter = (id: SourceControlSectionId): void => {
    if (cwd === undefined) return
    const staged = id === 'staged'
    openDiffAllSurface({
      cwd,
      staged,
      title: staged ? t('source-control.section.staged') : t('source-control.section.unstaged'),
      intent: 'preview',
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
      if (action === 'discard') toast(t('toast.discarded'))
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
    void writeClipboard(path).then(ok => {
      toast(ok ? t('toast.copied') : t('toast.copy-failed'))
    })
  }

  return (
    <div className={surfaceCss["dsh-studio-review-view"]} aria-label={t('workspace.changes')}>
      {cwd === undefined
        ? <EmptyState title={t('workspace.select')} />
        : (
          <>
            <ScrollArea className={surfaceCss["dsh-studio-workspace-content"]}>
            {error !== '' && <ErrorState message={error} />}

            {snapshot?.kind === 'repository' && (
              <CommitArea
                branch={snapshot.branch}
                branches={snapshot.branches}
                message={commitMessage}
                actions={sourceControlActions}
                operation={actionController.state}
                canGenerate={snapshot.changes.length > 0}
                generating={generatingCommitMessage}
                generationError={generationError}
                t={t}
                onMessageChange={setCommitMessage}
                onAction={kind => {
                  const runAction = async (): Promise<void> => {
                    if (kind === 'force-push') {
                      const confirmed = await confirmDialog({
                        title: t('workspace.commit-force-push'),
                        message: t('workspace.commit-force-push-confirm'),
                        confirmLabel: t('workspace.commit-force-push'),
                        cancelLabel: t('settings.done'),
                        danger: true,
                      })
                      if (!confirmed) return
                    }
                    if (kind === 'abort-merge' || kind === 'abort-rebase') {
                      const confirmed = await confirmDialog({
                        title: actionLabelForConfirmation(kind, t),
                        message: t('workspace.commit-abort-confirm'),
                        confirmLabel: actionLabelForConfirmation(kind, t),
                        cancelLabel: t('settings.done'),
                        danger: true,
                      })
                      if (!confirmed) return
                    }
                    await actionController.run(kind, kind === 'commit' ? commitMessage : '')
                  }
                  void runAction()
                }}
                onCheckout={branch => { void mutate({ action: 'checkout', branch }) }}
                onGenerate={() => { void generateCommitMessage() }}
                onCancelGenerate={cancelCommitMessageGeneration}
              />
            )}

            <section>
              <div className={surfaceCss["dsh-studio-change-list"]}>
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
                  onSelectFile={path => { openDiffInCenter(path, 'preview') }}
                  onOpenFile={path => { openDiffInCenter(path, 'pin') }}
                  onStage={paths => { void runPaths('stage', paths) }}
                  onUnstage={paths => { void runPaths('unstage', paths) }}
                  onDiscard={requestDiscard}
                  onViewAll={viewAllInCenter}
                  onCopyPath={copyPath}
                />
                {(snapshot?.changes.length ?? 0) > visibleChanges.length && (
                  <EmptyState
                    title={t('workspace.more-changes', {
                      count: (snapshot?.changes.length ?? 0) - visibleChanges.length,
                    })}
                  />
                )}
                {snapshot?.kind === 'repository' && snapshot.changes.length === 0 && (
                  <EmptyState title={t('workspace.clean')} />
                )}
                {snapshot?.kind === 'directory' && (
                  <EmptyState title={t('workspace.not-git')} />
                )}
              </div>
            </section>

            {snapshot?.kind === 'repository' && committed.status === 'ready' && committed.entries.length > 0 && (
              <section className={`dsh-studio-committed-section`}>
                <div
                  className={`${surfaceCss["dsh-studio-sc-toolbar"]} ${surfaceCss["dsh-studio-committed-header"]}`}
                  role="button"
                  tabIndex={0}
                  aria-expanded={!committedCollapsed}
                  onClick={() => { setCommittedCollapsed(collapsed => !collapsed) }}
                >
                  <span className={surfaceCss["dsh-studio-sc-toolbar-title"]}>
                    <IconGitCommit size={14} />
                    {t('workspace.committed')}
                    <em>{committed.entries.length}</em>
                  </span>
                  <span className={surfaceCss["dsh-studio-committed-actions"]}>
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
                      className={committedCollapsed ? 'dsh-studio-history-chevron is-collapsed' : 'dsh-studio-history-chevron'}
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

            {/* New-branch input and the workspace-directory footer row were
                removed from the surface (see .agent-workflows audit); the
                branch select in the commit area above still covers
                checkout. */}
          </ScrollArea>

          {snapshot?.kind === 'repository' && (
            <section className={surfaceCss["dsh-studio-review-history"]}>
              {!historyCollapsed && (
                <div
                  className={surfaceCss["dsh-studio-history-resize"]}
                  role="separator"
                  aria-label={t('workspace.review-history')}
                  onPointerDown={startHistoryResize}
                />
              )}
              <div
                className={`${surfaceCss["dsh-studio-sc-toolbar"]} ${surfaceCss["dsh-studio-history-toggle"]}`}
                role="button"
                tabIndex={0}
                aria-expanded={!historyCollapsed}
                onClick={() => { setHistoryCollapsed(collapsed => !collapsed) }}
              >
                <span className={surfaceCss["dsh-studio-sc-toolbar-title"]}>
                  <IconHistory size={14} />
                  {t('workspace.review-history')}
                  <em>{history.length}</em>
                </span>
                <IconChevronDown
                  size={14}
                  className={historyCollapsed ? 'dsh-studio-history-chevron is-collapsed' : 'dsh-studio-history-chevron'}
                />
              </div>
              {!historyCollapsed && (
                <ScrollArea
                  className={surfaceCss["dsh-studio-review-commit-list"]}
                  viewportClassName="dsh-studio-ui-scroll-viewport-inset"
                  style={{ maxHeight: historyHeight }}
                >
                  {history.map(entry => {
                    const isExpanded = expandedCommitId === entry.hashFull
                    return (
                      <Fragment key={entry.hashFull}>
                        <ListRow
                          className={`dsh-studio-review-commit-row`}
                          selected={isExpanded}
                          title={entry.subject}
                        >
                          <ListRowMain
                            className={surfaceCss["dsh-studio-sc-depth-main"]}
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
                              <span className={surfaceCss["dsh-studio-review-commit-author"]}>{entry.author}</span>
                              <code className={surfaceCss["dsh-studio-review-commit-hash"]}>{entry.hash}</code>
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
                    <EmptyState title={t('workspace.no-commits')} />
                  )}
                </ScrollArea>
              )}
            </section>
          )}
          </>
        )}
    </div>
  )
}
