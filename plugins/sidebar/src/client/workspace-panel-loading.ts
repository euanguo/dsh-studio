/**
 * Loading orchestration for the workspace Git review panel — the "加载编排"
 * leg of the three-way workspace-panel split (面板壳 / 加载编排 / 工具条).
 *
 * All Git DATA lives in the retained SourceControlRuntime (leaf-3.2: committed
 * + commitFiles caches moved into the per-cwd runtime snapshot); this hook
 * only wires the component surface to that runtime:
 *  - acquires/subscribes the retained runtime for the active cwd,
 *  - derives the rendered projections (snapshot, committed, commitFiles),
 *  - runs the load cadence while the review panel is active,
 *  - exposes the mutation / gesture callbacks the shell and sections dispatch.
 *
 * Anti-pattern fixes folded in here:
 *  - C34: the old `useEffect` resetting N panel-local states on cwd change is
 *    gone. The shell remounts this subtree via `key={cwd}`, so transient UI
 *    state (expanded commits, collapsed sets) resets naturally when the
 *    identity changes instead of via a reset-effect.
 *  - C35: the lazy commitFiles load chain is single-owner here —
 *    `commitFiles` is one fingerprint-driven projection and `ensureCommitFiles`
 *    is event-driven, routed through the runtime's generation gate, so a
 *    scope change can never let a stale response land.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import { basename } from '@dsh-studio/shared/path'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { toast } from '@dsh-studio/shared/toast'
import { confirmDialog } from './kit/dialog.tsx'
import { type Translate } from '@dsh-studio/shared/i18n'
import type { WorkspaceMessage } from './i18n.ts'
import type { ReviewCommentsService } from './review/review-comments.ts'
import type { WorkspaceChange } from '../protocol.ts'
import { errorMessage, type CommitFilesState, type CommittedState } from './commit-files.tsx'
import {
  sidebarApi,
  type CapabilitiesGitLogEntry,
  type CapabilitiesScope,
} from './sidebar-api.ts'
import {
  resolveSourceControlActions,
  type SourceControlActionKind,
  type SourceControlActionState,
} from './source-control/source-control-actions.ts'
import {
  useSourceControlActionController,
  type SourceControlActionController,
} from './source-control/source-control-action-controller.ts'
import type { SourceControlPendingAction } from './source-control/source-control-panel.tsx'
import {
  buildSourceControlRows,
  type SourceControlListMode,
  type SourceControlVisibleRow,
} from './source-control/source-control-view-model.ts'
import type { SourceControlSectionId } from './source-control/source-control-tree.ts'
import {
  getDiffRuntime,
  getSourceControlRuntime,
  sidebarScopeKey,
  type SourceControlRuntime,
} from './runtimes/registry.ts'
import type { SourceControlRuntimeSnapshot } from './runtimes/source-control-runtime.ts'
import { GIT_FALLBACK_POLL_MS, openGitWatch } from './runtimes/git-watch-client.ts'
import { useSidebarChromeStore } from './runtimes/chrome-store.ts'
import {
  openCommittedSurface,
  openCommitFileSurface,
  openCommitSurface,
  openConflictSurface,
  openDiffAllSurface,
  openDiffSurface,
  openFileSurface,
} from './open/pipeline.ts'

/** The visible change list cap (before the "more changes" notice). */
export const VISIBLE_CHANGES_LIMIT = 200

export interface WorkspacePanelData {
  runtime: SourceControlRuntime
  cwd: string
  scopeKey: string
  scope: CapabilitiesScope
  snapshot: SourceControlRuntimeSnapshot['snapshot']
  error: string
  history: readonly CapabilitiesGitLogEntry[]
  committed: CommittedState
  commitFiles: ReadonlyMap<string, CommitFilesState>
  branch: string | null
  visibleChanges: readonly WorkspaceChange[]
  rows: readonly SourceControlVisibleRow[]
  listMode: SourceControlListMode
  collapsedSections: ReadonlySet<SourceControlSectionId>
  collapsedDirectories: ReadonlySet<string>
  selectedPath: string | null
  commitMessage: string
  sourceControlActions: SourceControlActionState
  actionController: SourceControlActionController
  pendingByPath: ReadonlyMap<string, SourceControlPendingAction>
  generatingCommitMessage: boolean
  generationError: string | null
  setCommitMessage(message: string): void
  setGitListMode(mode: SourceControlListMode): void
  toggleSection(id: SourceControlSectionId): void
  toggleDirectory(key: string): void
  toggleCommitFiles(entry: CapabilitiesGitLogEntry): void
  ensureCommitFiles(hash: string): void
  refresh(): void
  refreshAfterAction(): void
  runPaths(action: SourceControlPendingAction, paths: readonly string[]): void
  requestDiscard(paths: readonly string[], label: string): void
  copyPath(path: string): void
  openDiff(path: string, intent: 'preview' | 'pin'): void
  viewAll(id: SourceControlSectionId): void
  openCommitDiff(entry: CapabilitiesGitLogEntry): void
  openCommitFile(entry: CapabilitiesGitLogEntry, path: string): void
  openCommittedAll(baseRef: string): void
  openCommittedFile(baseRef: string, path: string): void
  onCommitAction(kind: SourceControlActionKind): void
  onCheckout(branch: string): void
  generateCommitMessage(): void
  cancelCommitMessageGeneration(): void
}

/** Snapshot all cached per-commit file lists for rendering (C35 owner). */
function runtimeAllCommitFiles(
  runtime: SourceControlRuntime,
): ReadonlyMap<string, CommitFilesState> {
  const map = new Map<string, CommitFilesState>()
  for (const key of runtime.listCommitFileHashes()) {
    const state = runtime.getCommitFiles(key)
    if (state !== undefined) map.set(key, state)
  }
  return map
}

/**
 * Resolve the full panel data surface for one project (cwd). Runs only while
 * the shell has a concrete cwd (the subtree is remounted by key={cwd}).
 */
export function useWorkspaceSourceControl(options: {
  cwd: string
  /** Whether the review panel is currently open and active (poll gate). */
  active: boolean
  reviewComments: ReviewCommentsService
  t: Translate<WorkspaceMessage>
}): WorkspacePanelData {
  const { cwd, active, reviewComments, t } = options

  // Retained source-control runtime: the git snapshot survives tab switches
  // (registry keeps the instance; ready data renders instantly).
  const runtime = useMemo(
    () => getSourceControlRuntime({ cwd }),
    [cwd],
  )
  const runtimeFingerprint = useSyncExternalStore(
    useCallback((listener: () => void) => runtime.subscribe(listener) ?? (() => {}), [runtime]),
    useCallback(() => runtime.fingerprint(), [runtime]),
  )
  // The runtime snapshot is read during render; fingerprint changes re-render.
  void runtimeFingerprint
  const runtimeSnapshot = runtime.getSnapshot()
  const snapshot = runtimeSnapshot.snapshot
  const error = runtimeSnapshot.phase === 'error' ? (runtimeSnapshot.message ?? '') : ''
  const history = snapshot?.history ?? []
  const committed = runtimeSnapshot.committed ?? { status: 'none' as const }

  // The commitFiles map is a read-only projection over the runtime cache; the
  // fingerprint already includes its membership, so useSyncExternalStore
  // re-renders when a lazy list resolves (C35).
  const commitFiles: ReadonlyMap<string, CommitFilesState> = useMemo(
    () => runtimeAllCommitFiles(runtime),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fingerprint drives re-renders
    [runtime, runtimeFingerprint],
  )

  const scopeKey = sidebarScopeKey({ cwd })
  const scope: CapabilitiesScope = { cwd }
  const chrome = useSidebarChromeStore(state => state.getSlice(scopeKey))
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

  // Mutating the chrome store persists per-scope (mode, selection, message).
  const setGitListMode = (mode: SourceControlListMode): void => {
    useSidebarChromeStore.getState().setGitListMode(scopeKey, mode)
  }
  const toggleSection = (id: SourceControlSectionId): void => {
    useSidebarChromeStore.getState().toggleSourceControlSection(scopeKey, id)
  }
  const toggleDirectory = (key: string): void => {
    useSidebarChromeStore.getState().toggleSourceControlDirectory(scopeKey, key)
  }
  const setSelectedPath = useCallback((path: string): void => {
    useSidebarChromeStore.getState().setSourceControlSelectedPath(scopeKey, path)
  }, [scopeKey])
  const commitMessage = chrome?.sourceControl.commitMessage ?? ''
  const setCommitMessage = useCallback((message: string): void => {
    useSidebarChromeStore.getState().setSourceControlCommitMessage(scopeKey, message)
  }, [scopeKey])

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
  const branch = snapshot?.branch ?? null

  const refresh = useCallback((): Promise<void> => runtime.refresh(), [runtime])
  const refreshCommitted = useCallback((): Promise<void> => runtime.refreshCommitted(), [runtime])
  const invalidateWorktreeDiff = useCallback((): void => {
    getDiffRuntime({ cwd }).invalidateWorktree()
  }, [cwd])
  const refreshAfterAction = useCallback(async (): Promise<void> => {
    invalidateWorktreeDiff()
    await Promise.all([refresh(), refreshCommitted()])
  }, [invalidateWorktreeDiff, refresh, refreshCommitted])

  const actionController = useSourceControlActionController({
    scope,
    stagedCount: snapshot?.changes.filter(change => change.staged).length ?? 0,
    refresh: refreshAfterAction,
    onCommitted: () => { setCommitMessage('') },
  })
  const sourceControlActions = useMemo<SourceControlActionState>(() => resolveSourceControlActions({
    hasChanges: (snapshot?.changes.length ?? 0) > 0,
    hasUnresolvedConflicts: snapshot?.changes.some(change => change.status === 'conflicted') ?? false,
    hasMessage: commitMessage.trim() !== '',
    busy: actionController.state.phase === 'running',
    upstream: snapshot?.upstream,
  }), [actionController.state.phase, commitMessage, snapshot?.changes.length, snapshot?.upstream])

  // Load cadence while the review panel is open: ensure a first load, then
  // stay fresh through the git-watch push socket (server-side fingerprint
  // loop, ≤1s change latency). The fixed interval survives ONLY as a
  // disconnected fallback so a dead push channel degrades to the historical
  // behavior instead of going stale; both paths skip while the document is
  // hidden (focus / visibility listeners cover the return to the foreground).
  useEffect(() => {
    if (!active) return
    void runtime.ensureLoaded()
    void runtime.refreshCommitted()
    const refreshAll = (): void => {
      void runtime.refresh()
      void runtime.refreshCommitted()
    }
    let pushConnected = false
    let fallbackId: number | undefined
    const syncFallback = (): void => {
      if (pushConnected) {
        if (fallbackId !== undefined) {
          window.clearInterval(fallbackId)
          fallbackId = undefined
        }
        return
      }
      if (fallbackId === undefined) {
        fallbackId = window.setInterval(() => {
          if (!document.hidden) refreshAll()
        }, GIT_FALLBACK_POLL_MS)
      }
    }
    const watch = openGitWatch(cwd, {
      onChanged: refreshAll,
      onConnection: up => {
        pushConnected = up
        syncFallback()
        if (up) refreshAll()
      },
    })
    syncFallback()
    const onFocus = (): void => {
      refreshAll()
    }
    const onVisibility = (): void => {
      if (!document.hidden) {
        refreshAll()
      }
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      watch.close()
      if (fallbackId !== undefined) window.clearInterval(fallbackId)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [active, runtime])

  // Keep the review-comments rail bound to the current branch.
  useEffect(() => {
    if (branch === null) return
    reviewComments.activate(cwd, branch)
  }, [branch, cwd, reviewComments])

  // Expand one history row and lazy-load its file list (orca parity).
  const [pendingByPath, setPendingByPath] = useState<ReadonlyMap<string, SourceControlPendingAction>>(new Map())
  const ensureCommitFiles = useCallback((hash: string): void => {
    void runtime.ensureCommitFiles(hash)
  }, [runtime])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- expanded state lives in the section; here we only load.
  const toggleCommitFiles = useCallback((entry: CapabilitiesGitLogEntry): void => {
    const hash = entry.hashFull
    if (!commitFiles.has(hash)) ensureCommitFiles(hash)
  }, [commitFiles, ensureCommitFiles])

  const openDiff = useCallback((path: string, intent: 'preview' | 'pin'): void => {
    const name = basename(path)
    const change = snapshot?.changes.find(candidate => candidate.path === path)
    setSelectedPath(path)
    // Single click = preview diff tab; double click = pinned diff tab.
    // Untracked files have no diff baseline — show the file content instead.
    if (change === undefined || change.status === 'untracked') {
      openFileSurface({ cwd, filePath: path, title: name, intent })
      return
    }
    if (change.status === 'conflicted') {
      openConflictSurface({ cwd, filePath: path, title: name, intent })
      return
    }
    openDiffSurface({ cwd, filePath: path, staged: change.staged, title: name, intent })
  }, [cwd, snapshot?.changes, setSelectedPath])

  const viewAll = useCallback((id: SourceControlSectionId): void => {
    const staged = id === 'staged'
    openDiffAllSurface({
      cwd,
      staged,
      title: staged ? t('source-control.section.staged') : t('source-control.section.unstaged'),
      intent: 'preview',
    })
  }, [cwd, t])

  const openCommitDiff = useCallback((entry: CapabilitiesGitLogEntry): void => {
    openCommitSurface({
      cwd,
      hash: entry.hashFull,
      title: entry.subject || entry.hash,
      intent: 'preview',
    })
  }, [cwd])

  const openCommitFile = useCallback((entry: CapabilitiesGitLogEntry, filePath: string): void => {
    openCommitFileSurface({
      cwd,
      hash: entry.hashFull,
      filePath,
      title: filePath.split('/').pop() || filePath,
      intent: 'preview',
    })
  }, [cwd])

  const openCommittedAll = useCallback((baseRef: string): void => {
    openCommittedSurface({ cwd, baseRef, title: baseRef, intent: 'preview' })
  }, [cwd])

  const openCommittedFile = useCallback((baseRef: string, filePath: string): void => {
    openCommittedSurface({
      cwd,
      baseRef,
      filePath,
      title: filePath.split('/').pop() || filePath,
      intent: 'preview',
    })
  }, [cwd])

  const checkout = useCallback(async (branchName: string): Promise<void> => {
    await actionController.checkout(branchName)
    if (branchName === snapshot?.branch && branchName.length > 0) {
      void refreshAfterAction()
    }
  }, [actionController, refreshAfterAction, snapshot?.branch])

  const [generatingCommitMessage, setGeneratingCommitMessage] = useState(false)
  const [generationError, setGenerationError] = useState<string | null>(null)

  const generateCommitMessage = useCallback(async (): Promise<void> => {
    if (generatingCommitMessage) return
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
  }, [generatingCommitMessage, scope, setCommitMessage])

  const cancelCommitMessageGeneration = useCallback((): void => {
    void sidebarApi.gitCancelGenerateCommitMessage(scope)
    setGeneratingCommitMessage(false)
  }, [scope])

  const runPaths = useCallback(async (action: SourceControlPendingAction, paths: readonly string[]): Promise<void> => {
    if (paths.length === 0) return
    const pending = new Map(pendingByPath)
    for (const path of paths) pending.set(path, action)
    setPendingByPath(pending)
    try {
      if (action === 'stage') await sidebarApi.gitStage(scope, paths)
      else if (action === 'unstage') await sidebarApi.gitUnstage(scope, paths)
      else await sidebarApi.gitDiscard(scope, paths)
      if (action === 'discard') toast(t('toast.discarded'))
      await refreshAfterAction()
    } catch (nextError) {
      runtime.reportError(errorMessage(nextError))
    } finally {
      setPendingByPath(new Map())
    }
  }, [pendingByPath, refreshAfterAction, runtime, scope, t])

  const requestDiscard = useCallback(async (paths: readonly string[], label: string): Promise<void> => {
    const confirmed = await confirmDialog({
      title: t('source-control.discard'),
      message: t('source-control.discard-confirm', { paths: label }),
      confirmLabel: t('source-control.discard'),
      cancelLabel: t('dialog.cancel'),
      danger: true,
    })
    if (confirmed) void runPaths('discard', paths)
  }, [runPaths, t])

  const copyPath = useCallback((path: string): void => {
    void writeClipboard(path).then(ok => {
      toast(ok ? t('toast.copied') : t('toast.copy-failed'))
    })
  }, [t])

  const onCommitAction = useCallback((kind: SourceControlActionKind): void => {
    const run = async (): Promise<void> => {
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
          title: t(kind === 'abort-merge' ? 'workspace.commit-abort-merge' : 'workspace.commit-abort-rebase'),
          message: t('workspace.commit-abort-confirm'),
          confirmLabel: t(kind === 'abort-merge' ? 'workspace.commit-abort-merge' : 'workspace.commit-abort-rebase'),
          cancelLabel: t('settings.done'),
          danger: true,
        })
        if (!confirmed) return
      }
      const result = await actionController.run(kind, kind === 'commit' ? commitMessage : '')
      if (kind === 'commit' && result.stagedAll) {
        // D1: no index entries existed, so the commit staged everything first
        // — surface that explicitly.
        toast(t('workspace.commit-staged-all'))
      }
    }
    void run()
  }, [actionController, commitMessage, t])

  const onCheckout = useCallback((branchName: string): void => {
    void checkout(branchName)
  }, [checkout])

  return {
    runtime,
    cwd,
    scopeKey,
    scope,
    snapshot,
    error,
    history,
    committed,
    commitFiles,
    branch,
    visibleChanges,
    rows,
    listMode,
    collapsedSections,
    collapsedDirectories,
    selectedPath,
    commitMessage,
    sourceControlActions,
    actionController,
    pendingByPath,
    generatingCommitMessage,
    generationError,
    setCommitMessage,
    setGitListMode,
    toggleSection,
    toggleDirectory,
    toggleCommitFiles,
    ensureCommitFiles,
    refresh: () => { void refresh() },
    refreshAfterAction: () => { void refreshAfterAction() },
    runPaths: (action, paths) => { void runPaths(action, paths) },
    requestDiscard: (paths, label) => { void requestDiscard(paths, label) },
    copyPath,
    openDiff,
    viewAll,
    openCommitDiff,
    openCommitFile,
    openCommittedAll,
    openCommittedFile,
    onCommitAction,
    onCheckout,
    generateCommitMessage: () => { void generateCommitMessage() },
    cancelCommitMessageGeneration,
  }
}