/** Fork of the official ui-workspace browser (see
 * docs/official-plugin-migration.md): official source, official primitives,
 * official types — only the CSS pipeline is ours.
 * The workspace/session browsing region filling the sidebar shell's
 * `sidebar.workspaces` hole: section header (title + view options + add
 * workspace), search, the grouped tree or flat list, and the workspace
 * dialogs. Wide state renders the full browser; rail state renders the two
 * region icons (search / add workspace) as 36px controls on the shell's shared
 * rail entry path, each requesting expansion through the owner share. The
 * behavior composes extracted hooks/components from `./browser`.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from './shim/cn.ts'
import { Button, Modal, IconProjectAddOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceBrowserProps } from './contract/slots.ts'
import type { ProjectNode, ProjectTreeView, SessionNode } from './tree.ts'
import { repoExpansionKey, worktreeExpansionKey, DEFAULT_GROUP_ID } from './tree.ts'
import { FlatList, SearchResults, ViewOptionsMenu } from './workspace-browser-views.tsx'
import { ProjectSearchResults } from './ProjectSearchResults.tsx'
import { deriveLeftRailSnapshot } from './project-tree-model.ts'
import { createRailController } from './rail-controller.ts'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { toast } from '@dsh-studio/shared/toast'
import { FieldError, ToolbarAction } from '@dsh-studio/shared/ui'
import { WorkspaceBrowserCss as css } from './styles.ts'
import { WorkspacePickFlow } from './WorkspacePicker.tsx'
import { ProjectTreeBody } from './WorkspaceBrowserProjectTree.tsx'
import { createWorktree, useWorktreeLayouts, fetchWorktreeDefaults, fetchBranches, previewWorktreeRemoval, removeWorktree } from './worktree-api.ts'
import { ProjectIconModal } from './ProjectIconModal.tsx'
import { NewWorktreeDialog, type NewWtTarget } from './NewWorktreeDialog.tsx'
import { useSessionOrderAccounts } from './browser/useSessionOrderAccounts.ts'
import { useProjectIconDetection } from './browser/useProjectIconDetection.ts'
import { useLeftRailPersistence } from './browser/useLeftRailPersistence.ts'
import { useRenameDialogs } from './browser/useRenameDialogs.tsx'
import { useSearchControl, SearchHeaderSlot, RailSearchControl } from './browser/SearchSection.tsx'
import { dispatchProjectTreeAction, type DispatchContext } from './browser/action-dispatcher.ts'
import { DeleteWorkspaceDialog, type DeleteTarget as DeleteWorkspaceDialogTarget } from './browser/DeleteWorkspaceDialog.tsx'
import { PhysicalRemoveFlow, type PhysicalRemoveTarget } from './browser/PhysicalRemoveFlow.tsx'

export function WorkspaceBrowser({
  wide,
  expandSidebar,
  useSessions,
  useWorkspaces,
  useStore,
  actions,
  startSession,
  open,
  renameSession,
  forkSession,
  renameWorkspace,
  deleteWorkspace,
  insertWorkspaceBefore,
  archiveSession,
  insertSessionBefore,
  createWorkspace,
  openPath,
  searchSessions,
  searchResultLimit,
  useDirectoryFlow,
  renderSlot,
  t,
}: WorkspaceBrowserProps) {
  const workspaces = useWorkspaces(state => state.items)
  const sessionList = useSessions(s => s)
  const workspacePhase = useWorkspaces(state => state.phase)
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  const directoryFlowAvailable = useDirectoryFlow(occupied => occupied)
  const groupBy = useStore(s => s.groupBy)
  const orderBy = useStore(s => s.orderBy)
  const groupExpansion = useStore(s => s.groupExpansion)
  const sessionOrderByAccount = useStore(s => s.sessionOrderByAccount)
  const sessionUpdatedAtByAccount = useStore(s => s.sessionUpdatedAtByAccount)
  const activeTab = useStore(s => s.activeTab)
  const projectGroup = useStore(s => s.projectGroup)
  const groupIds = useStore(s => s.groupIds)
  const groupLabels = useStore(s => s.groupLabels)
  const projectAlias = useStore(s => s.projectAlias)
  const worktreeAlias = useStore(s => s.worktreeAlias)
  const projectIconOverrides = useStore(s => s.projectIconOverrides)

  const worktreeLayouts = useWorktreeLayouts(workspaces.map(workspace => workspace.path))
  const orderedWorkspaces = useSessionOrderAccounts({ workspaces, sessionList, workspacePhase, orderBy, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount: actions.syncSessionOrderAccount })
  const { projectIcons, refreshIcons } = useProjectIconDetection({ workspaces, layouts: worktreeLayouts.layouts, projectIconOverrides })
  useLeftRailPersistence({ actions, view: { activeTab, projectGroup, groupIds, groupLabels, projectAlias, worktreeAlias, projectIconOverrides, groupBy, orderBy, groupExpansion, sessionOrderByAccount }, workspaces, workspacePhase, layouts: worktreeLayouts.layouts, t })

  const railController = useMemo(
    () => createRailController({ preview: previewWorktreeRemoval, remove: removeWorktree, refresh: worktreeLayouts.refresh }),
    [],
  )

  // Reveal the current session in the three-level tree.
  const currentSessionId = useSessions(s => s.current)
  useEffect(() => {
    if (workspacePhase !== 'ready' || currentSessionId === undefined) return
    const container = workspaces.find(w => w.sessionIds.includes(currentSessionId))
    if (container === undefined) return
    const layout = worktreeLayouts.layouts.get(container.path)
    if (layout !== null && layout !== undefined) {
      actions.setGroupExpanded(repoExpansionKey(layout.repoRoot), true)
      let best: { path: string } | undefined
      for (const wt of layout.worktrees) {
        if (container.path === wt.path || container.path.startsWith(`${wt.path}/`)) {
          if (best === undefined || wt.path.length > best.path.length) best = wt
        }
      }
      if (best !== undefined) actions.setGroupExpanded(worktreeExpansionKey(best.path), true)
    } else {
      actions.setGroupExpanded(repoExpansionKey(container.path), true)
    }
  }, [workspacePhase, currentSessionId, workspaces, worktreeLayouts.layouts, actions.setGroupExpanded])

  // Add-flow state.
  const [wsPickerOpen, setWsPickerOpen] = useState(false)
  const wsPlusRef = useRef<HTMLElement>(null)

  // Search control (wide slot owns state; rail collapsed control shares it).
  const search = useSearchControl({ wide, searchSessions, closePicker: () => setWsPickerOpen(false) })

  // Copy-path feedback rides the shared app toast.
  const onCopy = (text: string): void => {
    void writeClipboard(text).then(ok => {
      toast(ok ? t('hover.copied') : t('copy.failed'))
    })
  }

  // All rename dialogs (workspace/session/project/worktree/group).
  const renameDialogs = useRenameDialogs({
    workspaces,
    renameWorkspace,
    renameSession,
    actions: {
      createGroup: actions.createGroup,
      renameGroup: actions.renameGroup,
      moveProjectToGroup: actions.moveProjectToGroup,
      setProjectAlias: actions.setProjectAlias,
      setWorktreeAlias: actions.setWorktreeAlias,
    },
    projectAlias,
    worktreeAlias,
    groupLabels,
    t,
  })

  // Shared tree view for the tree body + project search.
  const projectTreeView = useMemo<ProjectTreeView>(() => ({
    expanded: Object.entries(groupExpansion).filter(([, v]) => v).map(([k]) => k),
    activeTab,
    projectGroup,
    groupIds,
    groupLabels,
    projectAlias,
    worktreeAlias,
  }), [activeTab, groupExpansion, groupIds, groupLabels, projectAlias, projectGroup, worktreeAlias])
  const projectRailSnapshot = useMemo(
    () => deriveLeftRailSnapshot({
      list: sessionList,
      workspaces: orderedWorkspaces,
      layouts: worktreeLayouts.layouts,
      archivedSessionIds,
      view: projectTreeView,
      projectIcons,
    }),
    [archivedSessionIds, orderedWorkspaces, projectIcons, projectTreeView, sessionList, worktreeLayouts.layouts],
  )
  const jumpToProject = (project: ProjectNode): void => {
    const assigned = projectGroup[project.repoRoot] ?? DEFAULT_GROUP_ID
    actions.setActiveTab(groupIds.includes(assigned) ? assigned : DEFAULT_GROUP_ID)
    actions.setGroupExpanded(repoExpansionKey(project.repoRoot), true)
    search.setQuery('')
    search.setSearchExpanded(false)
  }

  // Row-level targets fed by the dispatcher.
  const [newWtTarget, setNewWtTarget] = useState<NewWtTarget | null>(null)
  const [iconModalProject, setIconModalProject] = useState<ProjectNode | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteWorkspaceDialogTarget | null>(null)
  const [physicalRemoveTarget, setPhysicalRemoveTarget] = useState<PhysicalRemoveTarget | null>(null)

  const openNewWorktree = (repoRoot: string): void => {
    const layout = worktreeLayouts.layouts.get(repoRoot)
    const worktrees = layout?.worktrees ?? [{ path: repoRoot, head: null, branch: null, main: true }]
    const base = repoRoot.replace(/[/\\]+$/, '')
    setNewWtTarget({
      repoRoot,
      label: base.slice(base.lastIndexOf('/') + 1),
      currentBranch: worktrees.find(w => w.main)?.branch ?? worktrees[0]?.branch ?? null,
      existing: worktrees.map(wt => ({
        label: wt.path.split(/[/\\]/).pop() ?? wt.path,
        branch: wt.branch,
      })),
    })
  }

  // Remove-project registration flow.
  const [removeProjectTarget, setRemoveProjectTarget] = useState<{ repoRoot: string; label: string; count: number } | null>(null)
  const [removeProjectPending, setRemoveProjectPending] = useState(false)
  const [removeProjectError, setRemoveProjectError] = useState<string | null>(null)
  const onRemoveProjectRequest = (repoRoot: string, label: string): void => {
    const layout = worktreeLayouts.layouts.get(repoRoot)
    setRemoveProjectTarget({ repoRoot, label, count: layout?.worktrees.length ?? 1 })
    setRemoveProjectError(null)
  }
  const closeRemoveProject = (): void => {
    if (removeProjectPending) return
    setRemoveProjectTarget(null)
  }
  const confirmRemoveProject = (): void => {
    if (removeProjectPending || removeProjectTarget === null) return
    setRemoveProjectPending(true)
    setRemoveProjectError(null)
    const ids = workspaces
      .filter(w => {
        const layout = worktreeLayouts.layouts.get(w.path)
        return (layout !== null && layout !== undefined && layout.repoRoot === removeProjectTarget.repoRoot)
          || w.path === removeProjectTarget.repoRoot
      })
      .map(w => w.workspaceId)
    Promise.allSettled(ids.map(id => deleteWorkspace(id))).then((results) => {
      setRemoveProjectPending(false)
      const failed = results.some(r => r.status === 'rejected')
      if (failed) setRemoveProjectError(t('project.remove.pending'))
      else setRemoveProjectTarget(null)
    })
  }

  const onSessionArchive = (sessionId: SessionNode['id']): void => {
    archiveSession(sessionId).catch((reason: unknown) => {
      console.warn('session archive rejected:', reason)
    })
  }

  const dispatchContext: DispatchContext = {
    t,
    actions: {
      setGroupExpanded: actions.setGroupExpanded,
      setProjectIconOverride: actions.setProjectIconOverride,
      moveProjectToGroup: actions.moveProjectToGroup,
    },
    workspaces,
    sessionList,
    snapshot: projectRailSnapshot,
    projectAlias,
    worktreeAlias,
    startSession,
    openPath,
    createWorkspace,
    refreshIcons,
    onCopy,
    onOpenNewWorktree: openNewWorktree,
    onOpenProjectAlias: renameDialogs.onOpenProjectAlias,
    onSetWorktreeAlias: renameDialogs.onOpenWorktreeAlias,
    onOpenGroup: (repoRoot, isNew) => {
      if (isNew) renameDialogs.onOpenNewGroup(repoRoot)
    },
    onOpenRemoveProject: onRemoveProjectRequest,
    onOpenDeleteTarget: (target) => { setDeleteTarget(target) },
    onOpenPhysicalRemove: (target) => { setPhysicalRemoveTarget(target) },
    onOpenIconModal: setIconModalProject,
    onOpenWorkspaceRename: renameDialogs.renameWorkspaceRequest,
  }

  return (
    <div className={cn(css.root, !wide && css.rail)}>
      <div className={css.sectionHeader}>
        {wide && <SearchHeaderSlot control={search} groupBy={groupBy} t={t} />}
        <div className={cn(css.headerActions, wide && search.searchExpanded && css.headerActionsHidden)}>
          {wide && (
            <ViewOptionsMenu
              groupBy={groupBy}
              orderBy={orderBy}
              onGroupPick={(mode) => { actions.setGroupBy(mode) }}
              onOrderPick={(mode) => { actions.setOrderBy(mode) }}
              t={t}
            />
          )}
          {directoryFlowAvailable && (
            <ToolbarAction
              ref={wsPlusRef}
              variant="ghost"
              className={css.iconButton}
              icon={<IconProjectAddOutline16 size={wide ? 16 : 18} />}
              label={t('workspace.add')}
              aria-expanded={wsPickerOpen}
              pressed={wsPickerOpen}
              onClick={() => { setWsPickerOpen(v => !v) }}
            />
          )}
        </div>
        <WorkspacePickFlow
          t={t}
          open={wsPickerOpen}
          anchorRef={wsPlusRef}
          useWorkspaces={useWorkspaces}
          createWorkspace={createWorkspace}
          useDirectoryFlow={useDirectoryFlow}
          renderDirectoryFlow={owner => renderSlot('sidebar.workspaces.directoryFlow', owner)}
          addOnly
          side="right"
          onPick={(workspaceId) => {
            setWsPickerOpen(false)
            startSession(workspaceId)
          }}
          onClose={() => { setWsPickerOpen(false) }}
        />
      </div>

      {!wide && <RailSearchControl control={search} expandSidebar={expandSidebar} t={t} />}

      <div className={css.listArea}>
        {wide && (search.normalizedQuery !== ''
          ? (
            <SearchResults
              useSessions={useSessions}
              open={open}
              query={search.normalizedQuery}
              archivedSessionIds={archivedSessionIds}
              workspaces={workspaces}
              remote={search.remoteSearch}
              resultLimit={searchResultLimit}
              header={groupBy === 'workspace' ? (
                <ProjectSearchResults
                  snapshot={projectRailSnapshot}
                  query={search.normalizedQuery}
                  onJump={jumpToProject}
                  t={t}
                />
              ) : undefined}
              t={t}
            />
          )
          : groupBy === 'flat'
            ? (
              <FlatList
                useSessions={useSessions}
                open={open}
                forkSession={forkSession}
                onSessionRename={renameDialogs.onSessionRename}
                onSessionArchive={onSessionArchive}
                orderBy={orderBy}
                archivedSessionIds={archivedSessionIds}
                sessionOrderByAccount={sessionOrderByAccount}
                sessionUpdatedAtByAccount={sessionUpdatedAtByAccount}
                syncSessionOrderAccount={actions.syncSessionOrderAccount}
                setSessionOrder={actions.setSessionOrder}
                t={t}
              />
            )
            : (
              <ProjectTreeBody
                snapshot={projectRailSnapshot}
                open={open}
                forkSession={forkSession}
                workspaces={workspaces}
                orderBy={orderBy}
                sessionOrderByAccount={sessionOrderByAccount}
                setSessionOrder={actions.setSessionOrder}
                insertSessionBefore={insertSessionBefore}
                onToggleProject={(key, expanded) => { actions.setGroupExpanded(repoExpansionKey(key), expanded) }}
                onToggleWorktree={(key, expanded) => { actions.setGroupExpanded(worktreeExpansionKey(key), expanded) }}
                onSetTab={actions.setActiveTab}
                onAction={(selection) => { dispatchProjectTreeAction(selection, dispatchContext) }}
                onNewGroup={renameDialogs.onOpenNewGroup}
                onRenameGroup={(tab) => { renameDialogs.onOpenRenameGroup(tab.id) }}
                onRemoveGroup={(tab) => { actions.removeGroup(tab.id) }}
                onSessionRename={renameDialogs.onSessionRename}
                onSessionArchive={onSessionArchive}
                loading={worktreeLayouts.loading}
                t={t}
              />
            ))}
      </div>

      {renameDialogs.modals}

      <DeleteWorkspaceDialog
        target={deleteTarget}
        onClose={() => { setDeleteTarget(null) }}
        railController={railController}
        deleteWorkspace={deleteWorkspace}
        refreshLayouts={worktreeLayouts.refresh}
        workspaces={workspaces}
        t={t}
      />

      <PhysicalRemoveFlow
        target={physicalRemoveTarget}
        onClose={() => { setPhysicalRemoveTarget(null) }}
        railController={railController}
        deleteWorkspace={deleteWorkspace}
        t={t}
      />

      <NewWorktreeDialog
        target={newWtTarget}
        t={t}
        fetchDefaults={fetchWorktreeDefaults}
        fetchBranches={fetchBranches}
        createWorktree={createWorktree}
        registerWorkspace={path => createWorkspace({ path })}
        onCreated={() => { worktreeLayouts.refresh() }}
        onClose={() => { setNewWtTarget(null) }}
      />

      <ProjectIconModal
        open={iconModalProject !== null}
        project={iconModalProject}
        onClose={() => { setIconModalProject(null) }}
        onSetBuiltin={(name) => {
          if (iconModalProject !== null) actions.setProjectIconOverride(iconModalProject.repoRoot, { kind: 'builtin', name })
        }}
        onUploadPng={(dataUrl) => {
          if (iconModalProject !== null) actions.setProjectIconOverride(iconModalProject.repoRoot, { kind: 'upload', mime: 'image/png', data: dataUrl })
        }}
        onRefresh={refreshIcons}
        onReset={() => {
          if (iconModalProject !== null) actions.setProjectIconOverride(iconModalProject.repoRoot, undefined)
        }}
        t={t}
      />

      <Modal
        open={removeProjectTarget !== null}
        onClose={closeRemoveProject}
        closeLabel={t('close')}
        title={t('project.remove.title')}
        {...removeProjectTarget === null
          ? {}
          : { description: `${t('project.remove.desc', { name: removeProjectTarget.label })} ${t('project.remove.count', { n: removeProjectTarget.count })}` }}
        footer={(
          <>
            <Button variant="outline" disabled={removeProjectPending} onClick={closeRemoveProject}>{t('cancel')}</Button>
            <Button
              variant="outline"
              className={css.deleteAction}
              disabled={removeProjectPending}
              onClick={confirmRemoveProject}
            >
              {removeProjectPending ? t('project.remove.pending') : t('project.remove.confirm')}
            </Button>
          </>
        )}
      >
        {removeProjectError !== null && <FieldError className={css.renameError}>{removeProjectError}</FieldError>}
      </Modal>
    </div>
  )
}