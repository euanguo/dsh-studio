/**
 * All five browser-owned rename dialogs (workspace, session, project alias,
 * worktree alias, and new/rename group) and their state machines. Rendered as
 * one `modals` fragment; handlers are exposed back to the tree and dispatcher.
 * The group-creation move gesture (`pendingMoveProject`) lives here so a
 * "move to new group" completes when the create dialog commits.
 */
import { useState, type ReactNode } from 'react'
import type { SessionId, WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionNode } from '../tree.ts'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import { RenameDialogModal } from '../RenameDialogModal.tsx'
import { FieldError } from '@dsh-studio/shared/ui'
import { errorMessage } from '@dsh-studio/shared/errors'
import { WorkspaceBrowserCss as css } from '../styles.ts'

export interface RenameDialogs {
  modals: ReactNode
  renameWorkspaceRequest: (workspaceId: WorkspaceId, title: string) => void
  onSessionRename: (sessionId: SessionNode['id'], currentTitle: string) => void
  onOpenProjectAlias: (repoRoot: string, label: string) => void
  onOpenWorktreeAlias: (worktreePath: string, label: string) => void
  onOpenNewGroup: (repoRoot?: string) => void
  onOpenRenameGroup: (id: string) => void
}

export function useRenameDialogs({
  workspaces,
  renameWorkspace,
  renameSession,
  actions,
  projectAlias,
  worktreeAlias,
  groupLabels,
  t,
}: {
  workspaces: readonly WorkspaceView[]
  renameWorkspace: (workspaceId: WorkspaceId, title: string) => Promise<void>
  renameSession: (sessionId: SessionId, title: string) => Promise<void>
  actions: {
    createGroup: (id: string, label: string) => void
    renameGroup: (id: string, label: string) => void
    moveProjectToGroup: (repoRoot: string, groupId: string | undefined) => void
    setProjectAlias: (repoRoot: string, alias: string | undefined) => void
    setWorktreeAlias: (worktreePath: string, alias: string | undefined) => void
  }
  projectAlias: Record<string, string>
  worktreeAlias: Record<string, string>
  groupLabels: Record<string, string>
  t: WorkspaceBrowserProps['t']
}): RenameDialogs {
  // ---- Workspace rename ----
  const [renameTarget, setRenameTarget] = useState<{ workspaceId: WorkspaceId; currentTitle: string } | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const renameTrimmed = renameDraft.trim()
  const renameDuplicate = renameTarget !== null && renameTrimmed !== '' && renameTrimmed !== renameTarget.currentTitle
    && workspaces.some(w => w.title === renameTrimmed)
  const renameBlocked = renaming || renameTrimmed === ''
    || renameTarget === null || renameTrimmed === renameTarget.currentTitle || renameDuplicate
  const closeRename = () => {
    if (renaming) return
    setRenameTarget(null)
    setRenameError(null)
  }
  const confirmRename = () => {
    if (renameBlocked) return
    setRenaming(true)
    setRenameError(null)
    renameWorkspace(renameTarget.workspaceId, renameTrimmed).then(() => {
      setRenaming(false)
      setRenameTarget(null)
    }).catch((reason: unknown) => {
      setRenaming(false)
      setRenameError(errorMessage(reason))
    })
  }

  // ---- Session rename ----
  const [sessionRenameTarget, setSessionRenameTarget] = useState<{ sessionId: SessionNode['id']; currentTitle: string } | null>(null)
  const [sessionRenameDraft, setSessionRenameDraft] = useState('')
  const [sessionRenaming, setSessionRenaming] = useState(false)
  const [sessionRenameError, setSessionRenameError] = useState<string | null>(null)
  const sessionRenameTrimmed = sessionRenameDraft.trim()
  const sessionRenameBlocked = sessionRenaming || sessionRenameTrimmed === '' || sessionRenameTarget === null
  const closeSessionRename = () => {
    if (sessionRenaming) return
    setSessionRenameTarget(null)
    setSessionRenameError(null)
  }
  const confirmSessionRename = () => {
    if (sessionRenameBlocked) return
    setSessionRenaming(true)
    setSessionRenameError(null)
    renameSession(sessionRenameTarget.sessionId, sessionRenameTrimmed).then(() => {
      setSessionRenaming(false)
      setSessionRenameTarget(null)
    }).catch((reason: unknown) => {
      setSessionRenaming(false)
      setSessionRenameError(errorMessage(reason))
    })
  }
  const onSessionRename = (sessionId: SessionNode['id'], currentTitle: string) => {
    setSessionRenameTarget({ sessionId, currentTitle })
    setSessionRenameDraft(currentTitle)
    setSessionRenameError(null)
  }

  // ---- Project alias ----
  const [projectAliasTarget, setProjectAliasTarget] = useState<{ repoRoot: string } | null>(null)
  const [projectAliasDraft, setProjectAliasDraft] = useState('')
  const closeRenameProject = (): void => { setProjectAliasTarget(null) }
  const confirmRenameProject = (): void => {
    if (projectAliasTarget === null) return
    const alias = projectAliasDraft.trim()
    actions.setProjectAlias(projectAliasTarget.repoRoot, alias === '' ? undefined : alias)
    setProjectAliasTarget(null)
  }

  // ---- Worktree alias ----
  const [worktreeAliasTarget, setWorktreeAliasTarget] = useState<{ worktreePath: string } | null>(null)
  const [worktreeAliasDraft, setWorktreeAliasDraft] = useState('')
  const closeRenameWorktree = (): void => { setWorktreeAliasTarget(null) }
  const confirmRenameWorktree = (): void => {
    if (worktreeAliasTarget === null) return
    const alias = worktreeAliasDraft.trim()
    actions.setWorktreeAlias(worktreeAliasTarget.worktreePath, alias === '' ? undefined : alias)
    setWorktreeAliasTarget(null)
  }

  // ---- New / rename group ----
  const [groupModal, setGroupModal] = useState<{ mode: 'create' } | { mode: 'rename'; id: string } | null>(null)
  const [groupDraft, setGroupDraft] = useState('')
  const [pendingMoveProject, setPendingMoveProject] = useState<string | null>(null)
  const openNewGroup = (): void => {
    setGroupModal({ mode: 'create' })
    setGroupDraft('')
  }
  const openRenameGroup = (id: string): void => {
    setGroupModal({ mode: 'rename', id })
    setGroupDraft(groupLabels[id] ?? id)
  }
  const closeGroupModal = (): void => { setGroupModal(null) }
  const confirmGroupModal = (): void => {
    const label = groupDraft.trim()
    if (label === '' || groupModal === null) return
    if (groupModal.mode === 'create') {
      const id = `group-${crypto.randomUUID()}`
      actions.createGroup(id, label)
      if (pendingMoveProject !== null) {
        actions.moveProjectToGroup(pendingMoveProject, id)
        setPendingMoveProject(null)
      }
    } else {
      actions.renameGroup(groupModal.id, label)
    }
    setGroupModal(null)
  }

  const modals = (
    <>
      <RenameDialogModal
        open={renameTarget !== null}
        title={t('rename.workspace.title')}
        fieldLabel={t('field.workspaceName')}
        value={renameDraft}
        onChange={setRenameDraft}
        onConfirm={confirmRename}
        onCancel={closeRename}
        confirmDisabled={renameBlocked}
        busy={renaming}
        error={(
          <>
            {renameDuplicate && (
              <FieldError className={css.renameError}>{t('conflict.named', { name: renameTrimmed })}</FieldError>
            )}
            {renameError !== null && <FieldError className={css.renameError}>{renameError}</FieldError>}
          </>
        )}
        t={t}
      />
      <RenameDialogModal
        open={sessionRenameTarget !== null}
        title={t('rename.session.title')}
        fieldLabel={t('field.sessionName')}
        value={sessionRenameDraft}
        onChange={(value) => { setSessionRenameDraft(value); setSessionRenameError(null) }}
        onConfirm={confirmSessionRename}
        onCancel={closeSessionRename}
        confirmDisabled={sessionRenameBlocked}
        busy={sessionRenaming}
        error={sessionRenameError}
        t={t}
      />
      <RenameDialogModal
        open={projectAliasTarget !== null}
        title={t('rename')}
        fieldLabel={t('field.workspaceName')}
        value={projectAliasDraft}
        onChange={setProjectAliasDraft}
        onConfirm={confirmRenameProject}
        onCancel={closeRenameProject}
        t={t}
      />
      <RenameDialogModal
        open={worktreeAliasTarget !== null}
        title={t('rename.workspace.title')}
        fieldLabel={t('field.workspaceName')}
        value={worktreeAliasDraft}
        onChange={setWorktreeAliasDraft}
        onConfirm={confirmRenameWorktree}
        onCancel={closeRenameWorktree}
        t={t}
      />
      <RenameDialogModal
        open={groupModal !== null}
        title={groupModal?.mode === 'rename' ? t('tab.renameGroup.title') : t('tab.newGroup.title')}
        fieldLabel={t('tab.groupName')}
        value={groupDraft}
        onChange={setGroupDraft}
        onConfirm={confirmGroupModal}
        onCancel={closeGroupModal}
        confirmDisabled={groupDraft.trim() === ''}
        t={t}
      />
    </>
  )

  const renameWorkspaceRequest = (workspaceId: WorkspaceId, title: string): void => {
    setRenameTarget({ workspaceId, currentTitle: title })
    setRenameDraft(title)
    setRenameError(null)
  }
  const onOpenProjectAlias = (repoRoot: string, label: string): void => {
    setProjectAliasTarget({ repoRoot })
    setProjectAliasDraft(projectAlias[repoRoot] ?? label)
  }
  const onOpenWorktreeAlias = (worktreePath: string, label: string): void => {
    setWorktreeAliasTarget({ worktreePath })
    setWorktreeAliasDraft(worktreeAlias[worktreePath] ?? label)
  }
  const onOpenNewGroup = (repoRoot?: string): void => {
    if (repoRoot !== undefined) setPendingMoveProject(repoRoot)
    openNewGroup()
  }

  return { modals, renameWorkspaceRequest, onSessionRename, onOpenProjectAlias, onOpenWorktreeAlias, onOpenNewGroup, onOpenRenameGroup: openRenameGroup }
}