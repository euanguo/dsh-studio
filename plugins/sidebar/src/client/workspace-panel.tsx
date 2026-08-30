/**
 * The workspace Git Review panel — the "面板壳" (panel shell) of the three-way
 * workspace-panel split (面板壳 / 加载编排 / 工具条).
 *
 * This module only composes the loading orchestration
 * (useWorkspaceSourceControl in workspace-panel-loading.ts) with the commit
 * area, the change list, and the two bottom toolbars
 * (workspace-panel-toolbar.tsx). All Git data lives in the retained
 * SourceControlRuntime; on an identity (cwd) change the content subtree is
 * remounted with `key={cwd}` so transient UI state resets naturally instead
 * of via a reset-effect (C34).
 */
import { useSyncExternalStore } from 'react'
import { SidebarSurfaceCss as surfaceCss } from './styles.js'
import { EmptyState, ErrorState, ScrollArea } from '@dsh-studio/shared/ui'
import type { Translate } from '@dsh-studio/shared/i18n'
import type { WorkspaceMessage } from './i18n.ts'
import type { DesktopSidebarService } from './contract.ts'
import type { SessionsService } from './client-types.ts'
import type { ReviewCommentsService } from './review/review-comments.ts'
import { CommitArea } from './source-control/commit-area.tsx'
import { SourceControlPanel } from './source-control/source-control-panel.tsx'
import { useWorkspaceSourceControl } from './workspace-panel-loading.ts'
import {
  CommittedSection,
  ReviewHistorySection,
} from './workspace-panel-toolbar.tsx'

export function WorkspacePanel({
  reviewComments,
  sessions,
  sidebar,
  t,
}: {
  reviewComments: ReviewCommentsService
  sessions: SessionsService
  sidebar: DesktopSidebarService
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const sidebarSnapshot = useSyncExternalStore(sidebar.subscribe, sidebar.getSnapshot)
  const activeTab = sidebarSnapshot.tabs.find(tab => tab.id === sidebarSnapshot.activeId)
  const panelActive = sidebarSnapshot.open && (activeTab?.type ?? 'menu') === 'review'
  // Identity reactivity rides the runtime's current-session projection
  // (leaf-1.7); the roster itself is read fresh at render.
  const currentSessionId = useSyncExternalStore(
    sessions.currentProvideInfo.subscribe,
    () => sessions.list.getSnapshot().current,
  )
  const sessionList = sessions.list.getSnapshot()
  const cwd = currentSessionId === undefined ? undefined : sessionList.byId[currentSessionId]?.cwd

  return (
    <div className={surfaceCss["dsh-studio-review-view"]} aria-label={t('workspace.changes')}>
      {cwd === undefined
        ? <EmptyState title={t('workspace.select')} />
        : (
          <WorkspacePanelBody
            key={cwd}
            cwd={cwd}
            active={panelActive}
            reviewComments={reviewComments}
            t={t}
          />
        )}
    </div>
  )
}

/** The mounted panel content for one project. `key={cwd}` on this node
 *  remounts it on an identity change, so all transient UI state downstream
 *  (expanded commits, collapsed sets, history height) resets for free — the
 *  C34 reset-effect replacement. */
function WorkspacePanelBody({
  cwd,
  active,
  reviewComments,
  t,
}: {
  cwd: string
  active: boolean
  reviewComments: ReviewCommentsService
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const panel = useWorkspaceSourceControl({ cwd, active, reviewComments, t })
  const { snapshot, error } = panel

  return (
    <>
      <ScrollArea className={surfaceCss["dsh-studio-workspace-content"]}>
        {error !== '' && <ErrorState message={error} />}

        {snapshot?.kind === 'repository' && (
          <CommitArea
            branch={snapshot.branch}
            branches={snapshot.branches}
            message={panel.commitMessage}
            actions={panel.sourceControlActions}
            operation={panel.actionController.state}
            canGenerate={snapshot.changes.length > 0}
            generating={panel.generatingCommitMessage}
            generationError={panel.generationError}
            t={t}
            onMessageChange={panel.setCommitMessage}
            onAction={panel.onCommitAction}
            onCheckout={panel.onCheckout}
            onGenerate={panel.generateCommitMessage}
            onCancelGenerate={panel.cancelCommitMessageGeneration}
          />
        )}

        <section>
          <div className={surfaceCss["dsh-studio-change-list"]}>
            <SourceControlPanel
              rows={panel.rows}
              pendingByPath={panel.pendingByPath}
              mode={panel.listMode}
              count={snapshot?.changes.length ?? 0}
              t={t}
              onModeChange={panel.setGitListMode}
              onToggleSection={panel.toggleSection}
              onToggleDirectory={panel.toggleDirectory}
              onSelectFile={path => { panel.openDiff(path, 'preview') }}
              onOpenFile={path => { panel.openDiff(path, 'pin') }}
              onStage={paths => { panel.runPaths('stage', paths) }}
              onUnstage={paths => { panel.runPaths('unstage', paths) }}
              onDiscard={panel.requestDiscard}
              onViewAll={panel.viewAll}
              onCopyPath={panel.copyPath}
            />
            {(snapshot?.changes.length ?? 0) > panel.visibleChanges.length && (
              <EmptyState
                title={t('workspace.more-changes', {
                  count: (snapshot?.changes.length ?? 0) - panel.visibleChanges.length,
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

        {snapshot?.kind === 'repository' && (
          <CommittedSection
            committed={panel.committed}
            listMode={panel.listMode}
            t={t}
            onOpenAll={panel.openCommittedAll}
            onOpenFile={panel.openCommittedFile}
          />
        )}
      </ScrollArea>

      {snapshot?.kind === 'repository' && (
        <ReviewHistorySection
          history={panel.history}
          commitFiles={panel.commitFiles}
          listMode={panel.listMode}
          t={t}
          onToggleFiles={panel.toggleCommitFiles}
          onOpenCommitDiff={panel.openCommitDiff}
          onOpenCommitFile={panel.openCommitFile}
        />
      )}
    </>
  )
}