/**
 * The desktop three-level tree body: group tabs plus the Project → Worktree
 * → Session projection. Rows receive semantic action selections; this module
 * owns only projection and view expansion, not Host or settings operations.
 */
import { Fragment, useMemo, useState } from 'react'
import { IconEllipsisOutline16, IconPlusOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId, WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import type { ActionSelection } from './domain/commands.ts'
import type { LeftRailSnapshot } from './project-tree-model.ts'
import type { WorkspaceBrowserProps } from './contract/slots.ts'
import type { GroupTab } from './tree.ts'
import { worktreeVisibleSessions } from './tree.ts'
import { WorkspaceBrowserCss as css } from './styles.js'
import { cn } from './shim/cn.ts'
import { EmptyState, LoadingState } from '@dsh-studio/shared/ui'
import { SessionNodeItem } from './rows/Rows.tsx'
import { ProjectRowItem, WorktreeRowItem, type WorktreeWorkspace } from './rows/ProjectRows.tsx'

/** Session rows visible per worktree before the local overflow control. */
const COLLAPSED_SESSION_LIMIT = 5

interface ProjectTreeBodyProps {
  snapshot: LeftRailSnapshot
  open: (id: SessionId) => void
  forkSession: (id: SessionId) => void
  workspaces: readonly WorkspaceView[]
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
  snapshot, open, forkSession, workspaces,
  onToggleProject, onToggleWorktree, onSetTab, onAction,
  onNewGroup, onRenameGroup, onRemoveGroup, onSessionRename, onSessionArchive, loading, t,
}: ProjectTreeBodyProps) {
  const tree = snapshot.tree
  const now = Date.now()
  const workspaceTitles = useMemo(() => {
    const byId = new Map<string, string>()
    for (const workspace of workspaces) byId.set(workspace.workspaceId as string, workspace.title)
    return byId
  }, [workspaces])
  // Transient widening of a worktree's five-session preview.
  const [expandedRuns, setExpandedRuns] = useState<string[]>([])

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

      <div className={css.list} role="tree" aria-label={t('section.workspaces')}>
        {loading && tree.projects.length === 0 && <LoadingState className={css.empty} label={t('picker.loading')} />}
        {tree.projects.length === 0 && !loading && <EmptyState className={css.empty} title={t('empty.none')} />}
        {tree.projects.map(project => {
          const wtRows = project.worktrees
          return (
            <div key={project.key} className={css.groupSection}>
              <ProjectRowItem
                project={project}
                t={t}
                tabs={tree.tabs}
                onToggle={() => { onToggleProject(project.key, !project.expanded) }}
                onAction={onAction}
              />
              {project.expanded && wtRows.map(worktree => {
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
                    />
                    {visibleSessions.map(node => (
                      <SessionNodeItem
                        key={node.id}
                        node={node}
                        currentId={snapshot.currentSessionId}
                        now={now}
                        onOpen={open}
                        onRename={onSessionRename}
                        onFork={forkSession}
                        onArchive={onSessionArchive}
                        nested
                        t={t}
                      />
                    ))}
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
      </div>
      <span className={css.fade} />
    </div>
  )
}
