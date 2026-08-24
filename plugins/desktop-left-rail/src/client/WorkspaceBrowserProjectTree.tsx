/**
 * The desktop three-level tree body: group tabs plus the Project → Worktree
 * → Session projection. Rows receive semantic action selections; this module
 * owns projection, expansion, and the Worktree session order interaction.
 */
import { Fragment, useMemo, useRef, useState } from 'react'
import { IconEllipsisOutline16, IconPlusOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId, WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import type { ActionSelection } from './domain/commands.ts'
import type { LeftRailSnapshot } from './project-tree-model.ts'
import type { WorkspaceBrowserProps } from './contract/slots.ts'
import type { SessionOrderBy, GroupTab } from './tree.ts'
import { activityKindsOf, activityOf, subtractActivity, worktreeVisibleSessions } from './tree.ts'
import { insertSessionInOrder, reconciledSessionOrder } from './session-order.ts'
import { WorkspaceBrowserCss as css } from './styles.ts'
import { cn } from './shim/cn.ts'
import { EmptyState, LoadingState, ScrollArea } from '@dsh-studio/shared/ui'
import { SessionNodeItem, type RowDragProps } from './rows/Rows.tsx'
import { ProjectRowItem, WorktreeRowItem, type WorktreeWorkspace } from './rows/ProjectRows.tsx'
import { useNativeDragAcceptance } from './workspace-browser-views.tsx'

/** Session rows visible per worktree before the local overflow control. */
const COLLAPSED_SESSION_LIMIT = 5

interface SessionDragState {
  /** Workspace account owning the dragged session. */
  accountKey: string
  sessionId: SessionId
  over: { id: SessionId; half: 'before' | 'after' } | null
}

interface ProjectTreeBodyProps {
  snapshot: LeftRailSnapshot
  open: (id: SessionId) => void
  forkSession: (id: SessionId) => void
  workspaces: readonly WorkspaceView[]
  orderBy: SessionOrderBy
  sessionOrderByAccount: Readonly<Record<string, readonly string[]>>
  setSessionOrder: (accountKey: string, order: string[]) => void
  insertSessionBefore: WorkspaceBrowserProps['insertSessionBefore']
  onToggleProject: (key: string, expanded: boolean) => void
  onToggleWorktree: (key: string, expanded: boolean) => void
  onSetTab: (tab: string) => void
  onAction: (selection: ActionSelection) => void
  onNewGroup: () => void
  onRenameGroup: (tab: GroupTab) => void
  onRemoveGroup: (tab: GroupTab) => void
  onSessionRename: (id: SessionId, title: string) => void
  onSessionArchive: (id: SessionId) => void
  loading: boolean
  t: WorkspaceBrowserProps['t']
}

export function ProjectTreeBody({
  snapshot, open, forkSession, workspaces, orderBy, sessionOrderByAccount,
  setSessionOrder, insertSessionBefore,
  onToggleProject, onToggleWorktree, onSetTab, onAction,
  onNewGroup, onRenameGroup, onRemoveGroup, onSessionRename, onSessionArchive, loading, t,
}: ProjectTreeBodyProps) {
  const tree = snapshot.tree
  const now = Date.now()
  const [expandedRuns, setExpandedRuns] = useState<string[]>([])
  const [drag, setDrag] = useState<SessionDragState | null>(null)
  const sessionDropCommitted = useRef(false)
  useNativeDragAcceptance(drag !== null)

  const workspaceTitles = useMemo(() => {
    const byId = new Map<string, string>()
    for (const workspace of workspaces) byId.set(workspace.workspaceId as string, workspace.title)
    return byId
  }, [workspaces])
  const workspacesById = useMemo(() => {
    const byId = new Map<string, WorkspaceView>()
    for (const workspace of workspaces) byId.set(workspace.workspaceId as string, workspace)
    return byId
  }, [workspaces])
  const accountBySession = useMemo(() => {
    const bySession = new Map<SessionId, string>()
    for (const workspace of workspaces) {
      const accountKey = workspace.workspaceId as string
      for (const sessionId of workspace.sessionIds) {
        if (!bySession.has(sessionId)) bySession.set(sessionId, accountKey)
      }
    }
    return bySession
  }, [workspaces])
  const sessionIdsForAccount = (accountKey: string): SessionId[] => {
    const workspace = workspacesById.get(accountKey)
    return workspace === undefined
      ? []
      : reconciledSessionOrder(workspace.sessionIds, sessionOrderByAccount[accountKey])
  }
  const moveSessionInAccount = (
    accountKey: string,
    sessionId: SessionId,
    verb: 'up' | 'down',
  ): void => {
    const account = sessionIdsForAccount(accountKey)
    const index = account.indexOf(sessionId)
    if (index === -1) return
    const swap = verb === 'up' ? index - 1 : index + 1
    if (swap < 0 || swap >= account.length) return
    const next = [...account]
    const moving = next[index]
    const displaced = next[swap]
    if (moving === undefined || displaced === undefined) return
    next[index] = displaced
    next[swap] = moving
    setSessionOrder(accountKey, next.map(id => id as string))
    if (orderBy === 'manual') {
      insertSessionBefore(accountKey as WorkspaceId, sessionId, next[swap + 1])
        .catch((reason: unknown) => {
          console.warn('session reorder rejected:', reason)
        })
    }
  }

  const commitSessionDrag = (
    activeDrag: SessionDragState,
    worktree: LeftRailSnapshot['tree']['projects'][number]['worktrees'][number],
    over: NonNullable<SessionDragState['over']>,
  ): void => {
    if (sessionDropCommitted.current) return
    sessionDropCommitted.current = true
    setDrag(null)
    if (accountBySession.get(over.id) !== activeDrag.accountKey) return
    const accountRows = worktree.sessions.filter(node => accountBySession.get(node.id) === activeDrag.accountKey)
    const targetIndex = accountRows.findIndex(node => node.id === over.id)
    if (targetIndex === -1) return
    const anchor = over.half === 'before' ? over.id : accountRows[targetIndex + 1]?.id
    if (anchor === activeDrag.sessionId) return
    const accountOrder = sessionIdsForAccount(activeDrag.accountKey)
    const sourceIndex = accountOrder.indexOf(activeDrag.sessionId)
    const anchorIndex = anchor === undefined ? accountOrder.length : accountOrder.indexOf(anchor)
    if (sourceIndex === -1 || (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return
    const nextOrder = insertSessionInOrder(accountOrder, activeDrag.sessionId, anchor)
    setSessionOrder(activeDrag.accountKey, nextOrder.map(id => id as string))
    if (orderBy === 'updated') return
    insertSessionBefore(activeDrag.accountKey as WorkspaceId, activeDrag.sessionId, anchor)
      .catch((reason: unknown) => {
        console.warn('session reorder rejected:', reason)
      })
  }

  return (
    <div className={cn(css.treeBody, css.wide)}>
      <div className={css.tabs} role="tablist">
        {tree.tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === tree.activeTab}
            className={cn(css.tab, tab.id === tree.activeTab && css.tabActive)}
            onClick={() => { onSetTab(tab.id) }}
          >
            {tab.pinned ? t('tab.default') : tab.label ?? tab.id}
          </button>
        ))}
        <button type="button" className={css.tabPlus} aria-label={t('tab.newGroup')} onClick={onNewGroup}>
          <IconPlusOutline16 size={14} />
        </button>
        <span className={css.tabDots}>
          <button
            type="button"
            className={cn(css.iconButton, css.wide)}
            aria-label={t('tab.newGroup')}
            onClick={() => {
              const tab = tree.tabs.find(candidate => candidate.id === tree.activeTab)
              if (tab !== undefined && !tab.pinned) onRenameGroup(tab)
              else onNewGroup()
            }}
          >
            <IconEllipsisOutline16 />
          </button>
        </span>
      </div>

      <ScrollArea
        className={css.listScroll}
        viewportClassName={css.list}
        viewportProps={{ role: 'tree', 'aria-label': t('section.workspaces') }}
      >
        {loading && tree.projects.length === 0 && <LoadingState className={css.empty} label={t('picker.loading')} />}
        {tree.projects.length === 0 && !loading && <EmptyState className={css.empty} title={t('empty.none')} />}
        {tree.projects.map(project => {
          // The project row folds its whole subtree: while collapsed, one
          // dot carries every hidden bucket (expanded rows speak for
          // themselves — no duplicate project-level dot).
          const projectKinds = project.expanded ? [] : activityKindsOf(project.activity)
          return (
          <div key={project.key} className={css.groupSection}>
            <ProjectRowItem
              project={project}
              t={t}
              tabs={tree.tabs}
              onToggle={() => { onToggleProject(project.key, !project.expanded) }}
              onAction={onAction}
              dot={projectKinds[0]}
              hiddenKinds={projectKinds}
            />
            {project.expanded && project.worktrees.map(worktree => {
              const wtWorkspaces: WorktreeWorkspace[] = worktree.workspaceIds.map(id => ({
                id: id as string,
                title: workspaceTitles.get(id as string) ?? id as string,
              }))
              const runExpanded = expandedRuns.includes(worktree.key)
              const visibleSessions = worktreeVisibleSessions(
                worktree.sessions,
                worktree.expanded,
                runExpanded,
                COLLAPSED_SESSION_LIMIT,
              )
              // The worktree dot signals activity the session rows cannot
              // show: a folded row hides everything; an expanded row hides
              // only the sessions past the preview limit.
              const hiddenKinds = activityKindsOf(
                subtractActivity(worktree.activity, activityOf(visibleSessions)),
              )
              const overflow = worktree.sessions.length > COLLAPSED_SESSION_LIMIT
              const toggleRun = (): void => {
                setExpandedRuns(runs => runs.includes(worktree.key)
                  ? runs.filter(key => key !== worktree.key)
                  : [...runs, worktree.key])
              }
              return (
                <Fragment key={worktree.key}>
                  <WorktreeRowItem
                    project={project}
                    worktree={worktree}
                    t={t}
                    onToggle={() => { onToggleWorktree(worktree.key, !worktree.expanded) }}
                    workspaces={wtWorkspaces}
                    onAction={onAction}
                    dot={hiddenKinds[0]}
                    hiddenKinds={hiddenKinds}
                  />
                  {visibleSessions.map(node => {
                    const accountKey = accountBySession.get(node.id)
                    const compatible = accountKey !== undefined && drag?.accountKey === accountKey
                    const dragProps: RowDragProps | undefined = accountKey === undefined
                      ? undefined
                      : {
                        start: () => {
                          sessionDropCommitted.current = false
                          setDrag({ accountKey, sessionId: node.id, over: null })
                        },
                        active: compatible,
                        marker: compatible && drag?.over?.id === node.id ? drag.over.half : null,
                        hover: (half) => {
                          setDrag(current => current === null || current.accountKey !== accountKey
                            ? current
                            : { ...current, over: { id: node.id, half } })
                        },
                        drop: (half) => {
                          if (drag?.accountKey !== accountKey) return
                          commitSessionDrag(drag, worktree, { id: node.id, half })
                        },
                        end: () => {
                          if (drag?.accountKey === accountKey && drag.over !== null) {
                            commitSessionDrag(drag, worktree, drag.over)
                          } else {
                            setDrag(null)
                          }
                          sessionDropCommitted.current = false
                        },
                      }
                    return (
                      <SessionNodeItem
                        key={node.id}
                        node={node}
                        currentId={snapshot.currentSessionId}
                        now={now}
                        onOpen={open}
                        onRename={onSessionRename}
                        onFork={forkSession}
                        onArchive={onSessionArchive}
                        onMove={accountKey === undefined
                          ? undefined
                          : verb => { moveSessionInAccount(accountKey, node.id, verb) }}
                        drag={dragProps}
                        nested
                        t={t}
                      />
                    )
                  })}
                  {worktree.expanded && overflow && (
                    <button
                      type="button"
                      className={css.sessionOverflowButton}
                      aria-expanded={runExpanded}
                      onClick={toggleRun}
                    >
                      {runExpanded
                        ? t('sessions.collapse')
                        : t('sessions.expand', { n: worktree.sessions.length - COLLAPSED_SESSION_LIMIT })}
                    </button>
                  )}
                </Fragment>
              )
            })}
          </div>
          )
        })}
      </ScrollArea>
      <span className={css.fade} />
    </div>
  )
}
