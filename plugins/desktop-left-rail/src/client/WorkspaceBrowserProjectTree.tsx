/**
 * The desktop three-level tree body: a horizontal group-tab strip + the
 * project → worktree → session list beneath it. Every level is foldable;
 * session rows reuse Rows.SessionNodeItem (official behavior) indented under
 * their worktree. Tab/group state and expansions come from the workspace
 * view store. A collapsed worktree previews its first five sessions and
 * offers "show the rest"; expanding reveals the full run and the collapse
 * verb.
 */
import { Fragment, useMemo } from 'react'
import { IconEllipsisOutline16, IconPlusOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId, WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkspaceBrowserProps } from './contract/slots.ts'
import type { GroupTab, ProjectTreeView, WorktreeLayoutMap } from './tree.ts'
import { deriveProjectTree } from './tree.ts'
import { WorkspaceBrowserCss as css } from './styles.js'
import { cn } from './shim/cn.ts'
import { SessionNodeItem } from './rows/Rows.tsx'
import { ProjectRowItem, WorktreeRowItem, type WorktreeWorkspace } from './rows/ProjectRows.tsx'

/** Session rows visible per worktree before the local overflow control. */
const COLLAPSED_SESSION_LIMIT = 5

interface ProjectTreeBodyProps {
  useSessions: WorkspaceBrowserProps['useSessions']
  open: (id: SessionId) => void
  forkSession: (id: SessionId) => void
  startSession: (workspaceId?: WorkspaceId) => void
  workspaces: readonly WorkspaceView[]
  layouts: WorktreeLayoutMap
  archivedSessionIds: readonly SessionId[]
  view: ProjectTreeView
  onToggleProject: (key: string, expanded: boolean) => void
  onToggleWorktree: (key: string, expanded: boolean) => void
  onSetTab: (tab: string) => void
  onNewWorktree: (repoRoot: string) => void
  onRemoveProject: (repoRoot: string, label: string) => void
  onMoveProject: (repoRoot: string, groupId: string | undefined) => void
  onNewGroup: () => void
  onRenameGroup: (tab: GroupTab) => void
  onRemoveGroup: (tab: GroupTab) => void
  onRenameWorktree: (workspaceId: string, title: string) => void
  onDeleteWorktree: (workspaceId: string, title: string) => void
  onSessionRename: (id: SessionId, title: string) => void
  onSessionArchive: (id: SessionId) => void
  onRenameProject: (repoRoot: string, currentLabel: string) => void
  onOpenPath: (path: string) => void
  onCopy: (text: string) => void
  loading: boolean
  t: WorkspaceBrowserProps['t']
}

export function ProjectTreeBody({
  useSessions, open, forkSession, startSession, workspaces, layouts, archivedSessionIds, view,
  onToggleProject, onToggleWorktree, onSetTab, onNewWorktree, onRemoveProject, onMoveProject,
  onNewGroup, onRenameGroup, onRemoveGroup, onRenameWorktree, onDeleteWorktree,
  onSessionRename, onSessionArchive, onRenameProject, onOpenPath, onCopy, loading, t,
}: ProjectTreeBodyProps) {
  const list = useSessions(s => s)
  const tree = useMemo(
    () => deriveProjectTree(list, workspaces, layouts, archivedSessionIds, view),
    [list, workspaces, layouts, archivedSessionIds, view],
  )
  const now = Date.now()
  const workspaceTitles = useMemo(() => {
    const byId = new Map<string, string>()
    for (const workspace of workspaces) byId.set(workspace.workspaceId as string, workspace.title)
    return byId
  }, [workspaces])

  return (
    <div className={cn(css.treeBody, css.wide)}>
      {/* Group tab strip. */}
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
            {/* The pinned catch-all tab is localized; user groups carry their own label. */}
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
              const tab = tree.tabs.find(t => t.id === tree.activeTab)
              if (tab !== undefined && !tab.pinned) onRenameGroup(tab)
              else onNewGroup()
            }}
          >
            <IconEllipsisOutline16 />
          </button>
        </span>
      </div>

      <div className={css.list} role="tree" aria-label={t('section.workspaces')}>
        {loading && tree.projects.length === 0 && (
          <div className={css.empty}>{t('picker.loading')}</div>
        )}
        {tree.projects.length === 0 && !loading && <div className={css.empty}>{t('empty.none')}</div>}
        {tree.projects.map((project) => {
          const wtRows = project.worktrees
          return (
            <div key={project.key} className={css.groupSection}>
              <ProjectRowItem
                project={project}
                t={t}
                tabs={tree.tabs}
                onToggle={() => { onToggleProject(project.key, !project.expanded) }}
                onCreate={() => { onNewWorktree(project.repoRoot) }}
                onMoveGroup={(groupId) => { onMoveProject(project.repoRoot, groupId) }}
                onRemove={() => { onRemoveProject(project.repoRoot, project.label) }}
                onRename={() => { onRenameProject(project.repoRoot, project.label) }}
                onOpenPath={() => { onOpenPath(project.repoRoot) }}
                onCopy={onCopy}
              />
              {project.expanded && wtRows.map((wt) => {
                const wtWorkspaces: WorktreeWorkspace[] = wt.workspaceIds.map(id => ({
                  id: id as string,
                  title: workspaceTitles.get(id as string) ?? id as string,
                }))
                const visibleSessions = wt.expanded ? wt.sessions : wt.sessions.slice(0, COLLAPSED_SESSION_LIMIT)
                const overflow = wt.sessions.length > COLLAPSED_SESSION_LIMIT
                return (
                  // Keyed Fragment: no wrapper element, so every row stays a
                  // direct child of .groupSection and `.groupSection > * + *`
                  // (the official 2px row gap) applies across all levels.
                  <Fragment key={wt.key}>
                    <WorktreeRowItem
                      worktree={wt}
                      t={t}
                      onToggle={() => { onToggleWorktree(wt.key, !wt.expanded) }}
                      onCreate={(workspaceId) => {
                        const target = workspaceId ?? (wt.workspaceIds.length === 1 ? wt.workspaceIds[0] as string : undefined)
                        if (target !== undefined) {
                          onToggleWorktree(wt.key, true)
                          startSession(target as WorkspaceId)
                        }
                      }}
                      workspaces={wtWorkspaces}
                      onRenameWorkspace={onRenameWorktree}
                      onDeleteWorkspace={onDeleteWorktree}
                      onOpenPath={() => { onOpenPath(wt.path) }}
                      onCopy={onCopy}
                    />
                    {visibleSessions.map(node => (
                      <SessionNodeItem
                        key={node.id}
                        node={node}
                        currentId={list.current}
                        now={now}
                        onOpen={open}
                        onRename={onSessionRename}
                        onFork={forkSession}
                        onArchive={onSessionArchive}
                        nested
                        t={t}
                      />
                    ))}
                    {overflow && (
                      <button
                        type="button"
                        className={css.sessionOverflowButton}
                        aria-expanded={wt.expanded}
                        onClick={() => { onToggleWorktree(wt.key, !wt.expanded) }}
                      >
                        {wt.expanded
                          ? t('sessions.collapse')
                          : t('sessions.expand', { n: wt.sessions.length - COLLAPSED_SESSION_LIMIT })}
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
