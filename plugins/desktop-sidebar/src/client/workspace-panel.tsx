/**
 * The workspace Git Review panel: changes list, commit history with line
 * comments, branch/commit/push controls, and background-process mirror.
 * Extracted from plugin.tsx (single-file assembly) into its own module.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import type {
  WorkspaceFacts,
  WorkspaceHostMutationResponse,
  WorkspaceMutation,
  WorkspaceSnapshot,
} from '../protocol.ts'
import { WORKSPACE_API_PATH } from '../protocol.ts'
import type { Translate } from '../../../shared/i18n.ts'
import {
  IconArrowLeft,
  IconBox,
  IconBranch,
  IconChevronDown,
  IconChevronUp,
  IconClose,
  IconCommit,
  IconExpand,
  IconHistory,
  IconPlus,
  IconPrompt,
  IconRefresh,
  IconRestore,
} from '../../../shared/icons.tsx'
import type { WorkspaceMessage } from './i18n.ts'
import {
  betterSidebarApi,
  type BetterSidebarGitLogEntry,
  type BetterSidebarScope,
} from './better-sidebar-api.ts'
import {
  EMPTY_CONVERSATION,
  type ConversationSnapshot,
  type RunningToolCall,
  type SessionsService,
  type WorkspaceTools,
  type WorkspacesService,
} from './client-types.ts'
import {
  nextReviewCommentId,
  ReviewCommentsService,
  type ReviewCommentSide,
} from './review-comments.ts'
import {
  reviewCommitFromBetterSidebar,
} from './review-diff.ts'
import type { GitReviewCommit, GitReviewFile } from './review-types.ts'
import { DiffViewer } from './diff/diff-viewer.tsx'
import type { DiffDocument } from './diff/file-diff.ts'
import { usePierreDiffTheme } from './diff/pierre-adapter.tsx'
import {
  SourceControlPanel,
  type SourceControlPendingAction,
} from './source-control-panel.tsx'
import {
  buildSourceControlRows,
  type SourceControlListMode,
  type SourceControlVisibleRow,
} from './source-control-view-model.ts'
import type { SourceControlSectionId } from './source-control-tree.ts'
import {
  getSourceControlRuntime,
  sidebarScopeKey,
} from './runtimes/registry.ts'
import { useSidebarChromeStore } from './runtimes/chrome-store.ts'
import { useCenterSurfaceStore } from './surfaces/center-surface-store.ts'

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function responseJson<T>(
  response: Response,
  t: Translate<WorkspaceMessage>,
): Promise<T> {
  const payload = await response.json() as T & { error?: string }
  if (!response.ok) {
    throw new Error(payload.error ?? t('workspace.request-failed', {
      status: response.status,
    }))
  }
  return payload
}

function workspaceUrl(cwd: string): string {
  const url = new URL(WORKSPACE_API_PATH, window.location.origin)
  url.searchParams.set('cwd', cwd)
  return url.href
}

type ReviewCommentTarget = {
  kind: 'commit'
} | {
  kind: 'line'
  filePath: string
  line: number
  side: Exclude<ReviewCommentSide, null>
}

/** GitReviewFile (commit review) → the unified DiffDocument shape. */
function reviewFileToDiffDocument(file: GitReviewFile): DiffDocument {
  return {
    path: file.path,
    change: file.status === 'added' ? 'added'
      : file.status === 'deleted' ? 'deleted'
      : file.status === 'renamed' ? 'renamed'
      : 'modified',
    additions: file.additions,
    deletions: file.deletions,
    lines: file.lines.slice(0, 400).map(line => {
      const kind = line.type === 'addition' ? 'added'
        : line.type === 'deletion' ? 'removed'
        : 'context'
      return {
        kind,
        text: line.content,
        displayText: line.content === '' ? ' ' : line.content,
        oldLine: line.oldLine,
        newLine: line.newLine,
        oldLineLabel: line.oldLine === null ? ' ' : String(line.oldLine),
        newLineLabel: line.newLine === null ? ' ' : String(line.newLine),
      }
    }),
  }
}

export function processTitle(call: RunningToolCall): string {
  try {
    const args = JSON.parse(call.argsRaw) as Record<string, unknown>
    const value = args.command ?? args.cmd ?? args.script ?? args.description
    if (Array.isArray(value)) return value.map(String).join(' ')
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  } catch {
    // Fall back to the raw tool name for non-JSON arguments.
  }
  return call.name
}

export function flattenRunningCalls(calls: readonly RunningToolCall[]): RunningToolCall[] {
  const result: RunningToolCall[] = []
  for (const call of calls) {
    result.push(call)
    result.push(...flattenRunningCalls(call.subCalls ?? []))
  }
  return result
}

function useActiveConversation(sessions: SessionsService, sessionId: string | undefined): ConversationSnapshot {
  const binding = sessionId === undefined ? undefined : sessions.binding(sessionId)
  const subscribe = useCallback(
    (listener: () => void) => binding?.session.subscribe(listener) ?? (() => {}),
    [binding],
  )
  const getSnapshot = useCallback(
    () => binding?.session.getSnapshot() ?? EMPTY_CONVERSATION,
    [binding],
  )
  return useSyncExternalStore(
    subscribe,
    getSnapshot,
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
  const theme = usePierreDiffTheme()
  const sessionList = useSyncExternalStore(sessions.list.subscribe, sessions.list.getSnapshot)
  const sessionId = sessionList.current
  const cwd = sessionId === undefined ? undefined : sessionList.byId[sessionId]?.cwd
  const conversation = useActiveConversation(sessions, sessionId)
  const processes = useMemo(
    () => flattenRunningCalls(conversation.runningCalls ?? []),
    [conversation.runningCalls],
  )
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
  const [commitOpen, setCommitOpen] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [newBranch, setNewBranch] = useState('')
  const [selectedCommit, setSelectedCommit] = useState<GitReviewCommit | null>(null)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [commentTarget, setCommentTarget] = useState<ReviewCommentTarget | null>(null)
  const [commentBody, setCommentBody] = useState('')
  const [commentNotice, setCommentNotice] = useState('')
  const comments = useSyncExternalStore(
    reviewComments.subscribe,
    reviewComments.getSnapshot,
  )
  const visibleChanges = snapshot?.changes.slice(0, 200) ?? []
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
  const scope = useMemo<BetterSidebarScope | undefined>(
    () => sessionId === undefined || cwd === undefined
      ? undefined
      : { sessionId, cwd },
    [cwd, sessionId],
  )
  const branch = snapshot?.branch ?? null
  const selectedComments = useMemo(() => comments.filter(comment =>
    selectedCommit !== null
    && comment.commitId === selectedCommit.id
    && comment.sessionId === (sessionId ?? null)
    && comment.workspacePath === cwd
    && comment.branch === branch), [
    branch,
    comments,
    cwd,
    selectedCommit,
    sessionId,
  ])

  const refresh = useCallback(async (): Promise<void> => {
    if (runtime === null) return
    await runtime.refresh()
  }, [runtime])

  useEffect(() => {
    if (!panelState.open || panelState.view !== 'review' || runtime === null) return
    void runtime.ensureLoaded()
    const timer = window.setInterval(() => { void runtime.refresh() }, 4_000)
    const onFocus = (): void => { void runtime.refresh() }
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [panelState.open, panelState.view, runtime])

  useEffect(() => {
    setSelectedCommit(null)
    setCommentTarget(null)
    setCommentBody('')
    setCommentNotice('')
  }, [cwd])

  useEffect(() => {
    if (cwd === undefined || branch === null) return
    reviewComments.activate(sessionId ?? null, cwd, branch)
  }, [branch, cwd, reviewComments, sessionId])

  const mutate = async (mutation: WorkspaceMutation): Promise<void> => {
    if (cwd === undefined || scope === undefined || busy) return
    setBusy(true)
    try {
      if (mutation.action === 'checkout') {
        await betterSidebarApi.gitCheckout(scope, mutation.branch)
      } else if (mutation.action === 'commit') {
        await betterSidebarApi.gitStage(scope)
        await betterSidebarApi.gitCommit(scope, mutation.message)
        setCommitMessage('')
      } else {
        const response = await fetch(workspaceUrl(cwd), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(mutation),
        })
        await responseJson<WorkspaceHostMutationResponse>(response, t)
      }
      await refresh()
    } catch (nextError) {
      runtime?.reportError(errorMessage(nextError))
    } finally {
      setBusy(false)
    }
  }

  const openDiffInCenter = (path: string, preview: boolean): void => {
    if (cwd === undefined || scopeKey === null) return
    const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path
    const change = snapshot?.changes.find(candidate => candidate.path === path)
    useSidebarChromeStore.getState().setSourceControlSelectedPath(scopeKey, path)
    // Single click = preview diff tab; double click = pinned diff tab.
    // Untracked files have no diff baseline — show the file content
    // instead of an empty "no diff" error.
    if (change === undefined || change.status === 'untracked') {
      useCenterSurfaceStore.getState().openFile({ sessionId: sessionId ?? '', cwd, filePath: path, title: name, preview })
      return
    }
    useCenterSurfaceStore.getState().openDiff({ sessionId: sessionId ?? '', cwd, filePath: path, staged: change.staged, title: name, preview })
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
      if (action === 'stage') await betterSidebarApi.gitStage(scope, paths.length === 1 ? paths[0] : undefined)
      else if (action === 'unstage') await betterSidebarApi.gitUnstage(scope, paths.length === 1 ? paths[0] : undefined)
      else await betterSidebarApi.gitDiscard(scope, paths.length === 1 ? paths[0] : undefined)
      await refresh()
    } catch (nextError) {
      runtime?.reportError(errorMessage(nextError))
    } finally {
      setPendingByPath(new Map())
    }
  }

  const requestDiscard = (paths: readonly string[], label: string): void => {
    const confirmed = window.confirm(t('source-control.discard-confirm', { paths: label }))
    if (confirmed) void runPaths('discard', paths)
  }

  const copyPath = (path: string): void => {
    void navigator.clipboard?.writeText(path)
  }

  const showCommit = async (entry: BetterSidebarGitLogEntry): Promise<void> => {
    if (scope === undefined || reviewLoading) return
    if (selectedCommit?.id === entry.hashFull) {
      setSelectedCommit(null)
      setCommentTarget(null)
      return
    }
    setReviewLoading(true)
    setCommentTarget(null)
    setCommentBody('')
    setCommentNotice('')
    try {
      const result = await betterSidebarApi.gitCommitDiff(
        scope,
        entry.hashFull,
      )
      setSelectedCommit(reviewCommitFromBetterSidebar(entry, result.diff))
    } catch (nextError) {
      runtime?.reportError(errorMessage(nextError))
    } finally {
      setReviewLoading(false)
    }
  }

  const addReviewComment = (): void => {
    if (selectedCommit === null || cwd === undefined || branch === null
      || commentTarget === null || commentBody.trim() === '') return
    const lineTarget = commentTarget.kind === 'line' ? commentTarget : null
    const result = reviewComments.add(selectedCommit, {
      id: nextReviewCommentId(),
      sessionId: sessionId ?? null,
      workspacePath: cwd,
      branch,
      commitId: selectedCommit.id,
      filePath: lineTarget?.filePath ?? null,
      line: lineTarget?.line ?? null,
      side: lineTarget?.side ?? null,
      body: commentBody.trim(),
      createdAt: new Date().toISOString(),
    })
    setCommentBody('')
    setCommentTarget(null)
    setCommentNotice(result === 'inserted'
      ? t('workspace.comment-added')
      : t('workspace.comment-saved'))
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
      <header className="oh-dsh-workspace-header">
        <div>
          <button type="button" aria-label={t('side.back')} onClick={() => { service.openMenu() }}><IconArrowLeft size={16} /></button>
          <strong>{snapshot?.name ?? (cwd?.split(/[\\/]/).filter(Boolean).pop() || t('workspace.title'))}</strong>
        </div>
        <div>
          <button type="button" onClick={() => { void refresh() }} aria-label={t('workspace.refresh')} title={t('workspace.refresh')}><IconRefresh size={16} /></button>
          <button type="button" onClick={() => { void chooseWorkspace() }} aria-label={t('workspace.add')} title={t('workspace.add')}><IconPlus size={16} /></button>
          <button
            type="button"
            aria-label={panelState.maximized ? t('side.restore') : t('side.expand')}
            title={panelState.maximized ? t('side.restore') : t('side.expand')}
            aria-pressed={panelState.maximized}
            onClick={() => { service.togglePanelMaximized() }}
          >{panelState.maximized ? <IconRestore size={16} /> : <IconExpand size={16} />}</button>
          <button type="button" onClick={() => { service.setOpen(false) }} aria-label={t('workspace.close-review')} title={t('workspace.close-review')}><IconClose size={16} /></button>
        </div>
      </header>

      {cwd === undefined
        ? <div className="oh-dsh-workspace-empty">{t('workspace.select')}</div>
        : (
          <div className="oh-dsh-workspace-content">
            {error !== '' && <div className="oh-dsh-workspace-error" role="alert">{error}</div>}
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
                  onCopyPath={copyPath}
                />
                {(snapshot?.changes.length ?? 0) > visibleChanges.length && (
                  <div className="oh-dsh-workspace-muted">
                    {t('workspace.more-changes', {
                      count: (snapshot?.changes.length ?? 0) - visibleChanges.length,
                    })}
                  </div>
                )}
                {snapshot?.kind === 'repository' && snapshot.changes.length === 0 && (
                  <div className="oh-dsh-workspace-muted">{t('workspace.clean')}</div>
                )}
                {snapshot?.kind === 'directory' && (
                  <div className="oh-dsh-workspace-muted">{t('workspace.not-git')}</div>
                )}
              </div>
            </section>

            {snapshot?.kind === 'repository' && (
              <section className="oh-dsh-review-history">
                <div className="oh-dsh-workspace-section-title">
                  <span className="oh-dsh-workspace-section-icon"><IconHistory size={16} /></span>
                  <strong>{t('workspace.review-history')}</strong>
                  <span className="oh-dsh-workspace-count">{history.length}</span>
                </div>
                <div className="oh-dsh-review-commit-list">
                  {history.map(entry => (
                    <button
                      type="button"
                      key={entry.hashFull}
                      className="oh-dsh-review-commit-row"
                      data-selected={selectedCommit?.id === entry.hashFull || undefined}
                      disabled={reviewLoading}
                      onClick={() => { void showCommit(entry) }}
                    >
                      <code>{entry.hash}</code>
                      <span title={entry.subject}>{entry.subject}</span>
                      <small>{entry.author}</small>
                    </button>
                  ))}
                  {history.length === 0 && (
                    <div className="oh-dsh-workspace-muted">
                      {t('workspace.no-commits')}
                    </div>
                  )}
                </div>

                {selectedCommit !== null && (
                  <div className="oh-dsh-review-commit-detail">
                    <header>
                      <div>
                        <code>{selectedCommit.shortId}</code>
                        <strong>{selectedCommit.subject}</strong>
                        <small>
                          {selectedCommit.author} · {selectedCommit.authoredAt}
                        </small>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setCommentTarget({ kind: 'commit' })
                          setCommentNotice('')
                        }}
                      >{t('workspace.comment-commit')}</button>
                    </header>

                    {selectedComments.length > 0 && (
                      <div className="oh-dsh-review-comments">
                        <strong>{t('workspace.pending-comments')}</strong>
                        {selectedComments.map(comment => (
                          <div key={comment.id}>
                            <span>
                              {comment.filePath === null
                                ? t('workspace.review-commit')
                                : `${comment.filePath}:${String(comment.line)}`}
                            </span>
                            <p>{comment.body}</p>
                            <button
                              type="button"
                              aria-label={t('workspace.remove-comment')}
                              title={t('workspace.remove-comment')}
                              onClick={() => { reviewComments.remove(comment.id) }}
                            ><IconClose size={12} /></button>
                          </div>
                        ))}
                      </div>
                    )}

                    {selectedCommit.files.map(file => (
                      <details key={`${file.oldPath ?? ''}:${file.path}`} open>
                        <summary>
                          <span title={file.path}>{file.path}</span>
                          <small>
                            <b>+{file.additions}</b> −{file.deletions}
                          </small>
                        </summary>
                        <div className="oh-dsh-review-diff-lines">
                          <DiffViewer
                            document={reviewFileToDiffDocument(file)}
                            theme={theme}
                            rawOnly
                            hideMeta
                            onLineClick={line => {
                              const lineNumber = line.oldLine ?? line.newLine
                              if (lineNumber === null) return
                              setCommentTarget({
                                kind: 'line',
                                filePath: file.path,
                                line: lineNumber,
                                side: line.oldLine !== null && line.newLine === null ? 'old' : 'new',
                              })
                              setCommentNotice('')
                            }}
                          />
                          {file.lines.length > 400 && (
                            <div className="oh-dsh-workspace-muted">
                              {t('workspace.diff-truncated', {
                                count: file.lines.length - 400,
                              })}
                            </div>
                          )}
                        </div>
                      </details>
                    ))}

                    {commentTarget !== null && (
                      <div className="oh-dsh-review-comment-form">
                        <strong>
                          {commentTarget.kind === 'commit'
                            ? t('workspace.comment-commit')
                            : `${commentTarget.filePath}:${String(commentTarget.line)}`}
                        </strong>
                        <textarea
                          autoFocus
                          value={commentBody}
                          placeholder={t('workspace.comment-placeholder')}
                          onChange={event => { setCommentBody(event.currentTarget.value) }}
                        />
                        <div>
                          <button
                            type="button"
                            onClick={() => {
                              setCommentTarget(null)
                              setCommentBody('')
                            }}
                          >{t('workspace.cancel')}</button>
                          <button
                            type="button"
                            disabled={commentBody.trim() === ''}
                            onClick={addReviewComment}
                          >{t('workspace.add-comment')}</button>
                        </div>
                      </div>
                    )}
                    {commentNotice !== '' && (
                      <p className="oh-dsh-review-comment-notice">
                        {commentNotice}
                      </p>
                    )}
                  </div>
                )}
              </section>
            )}

            <section className="oh-dsh-workspace-facts">
              <label className="oh-dsh-workspace-fact">
                <span className="oh-dsh-workspace-fact-icon"><IconBox size={16} /></span>
                <select aria-label={t('workspace.execution-environment')} value="local" onChange={() => {}}>
                  <option value="local">{t('workspace.local')}</option>
                </select>
                <span className="oh-dsh-workspace-chevron"><IconChevronDown size={14} /></span>
              </label>
              <label className="oh-dsh-workspace-fact">
                <span className="oh-dsh-workspace-fact-icon"><IconBranch size={16} /></span>
                <select
                  value={snapshot?.branch ?? ''}
                  disabled={snapshot?.kind !== 'repository' || busy}
                  aria-label={t('workspace.current-branch')}
                  onChange={event => { void mutate({ action: 'checkout', branch: event.currentTarget.value }) }}
                >
                  {(snapshot?.branches ?? []).map(branch => <option key={branch} value={branch}>{branch}</option>)}
                </select>
                <span className="oh-dsh-workspace-chevron"><IconChevronDown size={14} /></span>
              </label>
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
              <button
                type="button"
                className="oh-dsh-workspace-fact oh-dsh-commit-toggle"
                onClick={() => { setCommitOpen(open => !open) }}
                aria-expanded={commitOpen}
              >
                <span className="oh-dsh-workspace-fact-icon"><IconCommit size={16} /></span>
                <span>{t('workspace.commit-or-push')}</span>
                <span className="oh-dsh-workspace-chevron">{commitOpen ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}</span>
              </button>
              {commitOpen && snapshot?.kind === 'repository' && (
                <div className="oh-dsh-commit-box">
                  <textarea
                    value={commitMessage}
                    placeholder={t('workspace.commit-message')}
                    aria-label={t('workspace.commit-message')}
                    onChange={event => { setCommitMessage(event.currentTarget.value) }}
                  />
                  <div>
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
                </div>
              )}
            </section>

            <section className="oh-dsh-workspace-directory">
              <span>{snapshot?.name ?? cwd.split(/[\\/]/).filter(Boolean).pop()}</span>
              <small title={cwd}>{cwd}</small>
              <button type="button" onClick={() => { void chooseWorkspace() }} aria-label={t('workspace.add')}><IconPlus size={16} /></button>
            </section>

            <section className="oh-dsh-processes">
              <h3>{t('workspace.background-processes')}</h3>
              {processes.map(process => (
                <div key={process.callId} className="oh-dsh-process-row">
                  <span><IconPrompt size={14} /></span>
                  <code title={processTitle(process)}>{processTitle(process)}</code>
                </div>
              ))}
              {processes.length === 0 && (
                <div className="oh-dsh-workspace-muted">{t('workspace.no-background-processes')}</div>
              )}
            </section>
          </div>
        )}
    </div>
  )
}
