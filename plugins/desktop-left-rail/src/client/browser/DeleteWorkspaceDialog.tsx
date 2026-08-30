/**
 * Delete-workspace confirmation dialog for a registered Worktree row. Owns the
 * opt-in physical-escalation state (dirty/locked preview fetched on check),
 * the in-flight commit state and the committed-identity wait that keeps the
 * confirmation visible until the registry projection drops the id. Registration
 * removal and physical WorkTree deletion via the rail controller and
 * deleteWorkspace cleanup share this dialog, matching the original behavior.
 */
import { useEffect, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import { Checkbox, FieldError, StatusLine } from '@dsh-studio/shared/ui'
import { errorMessage } from '@dsh-studio/shared/errors'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { RailController } from '../rail-controller.ts'
import { WorkspaceBrowserCss as css } from '../styles.ts'

export interface DeleteTarget {
  workspaceId: WorkspaceId
  title: string
  repoRoot?: string
  worktreePath?: string
  physicalAvailable?: boolean
  workspaceIds?: WorkspaceId[]
}

export function DeleteWorkspaceDialog({
  target,
  onClose,
  railController,
  deleteWorkspace,
  refreshLayouts,
  workspaces,
  t,
}: {
  target: DeleteTarget | null
  onClose: () => void
  railController: RailController
  deleteWorkspace: (workspaceId: WorkspaceId) => Promise<void>
  refreshLayouts: () => void
  workspaces: readonly WorkspaceView[]
  t: WorkspaceBrowserProps['t']
}): JSX.Element {
  const [deletePhysical, setDeletePhysical] = useState(false)
  const [deletePhysicalPreview, setDeletePhysicalPreview] = useState<{ dirty: boolean; locked: boolean } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteCommittedId, setDeleteCommittedId] = useState<WorkspaceId | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Reset transient state whenever a new target opens.
  useEffect(() => {
    if (target === null) return
    setDeletePhysical(false)
    setDeletePhysicalPreview(null)
    setDeleting(false)
    setDeleteCommittedId(null)
    setDeleteError(null)
  }, [target])

  // Keep the confirmation pending until the committed list projection renders
  // without the deleted id. Closing earlier exposes one stale React frame to
  // the next Create Workspace gesture.
  useEffect(() => {
    if (deleteCommittedId === null
      || workspaces.some(workspace => workspace.workspaceId === deleteCommittedId)) return
    setDeleting(false)
    setDeleteCommittedId(null)
    onClose()
  }, [deleteCommittedId, workspaces])

  const closeDelete = (): void => {
    if (deleting) return
    onClose()
  }
  const toggleDeletePhysical = (checked: boolean): void => {
    setDeletePhysical(checked)
    setDeletePhysicalPreview(null)
    if (!checked || target?.repoRoot === undefined || target.worktreePath === undefined) return
    void railController.previewPhysicalWorktree(target.repoRoot, target.worktreePath)
      .then(preview => { setDeletePhysicalPreview({ dirty: preview.dirty, locked: preview.locked }) })
      .catch(reason => { setDeleteError(errorMessage(reason)) })
  }
  const confirmDelete = (): void => {
    if (deleting || target === null) return
    setDeleting(true)
    setDeleteCommittedId(null)
    setDeleteError(null)

    if (deletePhysical && target.physicalAvailable === true
      && target.repoRoot !== undefined && target.worktreePath !== undefined) {
      void railController.removePhysicalWorktree(target.repoRoot, target.worktreePath, false)
        .then(async () => {
          const cleanup = await Promise.allSettled(
            (target.workspaceIds ?? [target.workspaceId]).map(id => deleteWorkspace(id)),
          )
          const failed = cleanup.filter(result => result.status === 'rejected').length
          if (failed > 0) {
            setDeleting(false)
            setDeleteError(t('worktree.remove.cleanupFailed', { count: failed }))
            return
          }
          refreshLayouts()
          setDeleting(false)
          onClose()
        })
        .catch(reason => {
          setDeleting(false)
          setDeleteError(errorMessage(reason))
        })
      return
    }

    deleteWorkspace(target.workspaceId).then(() => {
      setDeleteCommittedId(target.workspaceId)
    }).catch((reason: unknown) => {
      setDeleting(false)
      setDeleteError(errorMessage(reason))
    })
  }

  return (
    <Modal
      open={target !== null}
      onClose={closeDelete}
      closeLabel={t('close')}
      title={t('delete.workspace')}
      {...target === null ? {} : { description: t('delete.desc', { name: target.title }) }}
      footer={(
        <>
          <Button variant="outline" disabled={deleting} onClick={closeDelete}>{t('cancel')}</Button>
          <Button
            variant="outline"
            className={css.deleteAction}
            disabled={deleting || (deletePhysical && deletePhysicalPreview?.dirty === true)}
            onClick={confirmDelete}
          >
            {t('delete.workspace')}
          </Button>
        </>
      )}
    >
      {target?.physicalAvailable === true && (
        <label className={css.deletePhysicalRow} htmlFor="dsh-studio-delete-physical">
          <Checkbox
            id="dsh-studio-delete-physical"
            checked={deletePhysical}
            disabled={deleting}
            onCheckedChange={checked => { toggleDeletePhysical(checked) }}
          />
          <span>
            {t('delete.physical')}
            {deletePhysical && deletePhysicalPreview?.dirty === true && (
              <span className={css.deletePhysicalDirty} role="alert">
                {' '}{t('worktree.removePhysical.dirty')}
              </span>
            )}
          </span>
        </label>
      )}
      {deleting && <StatusLine className={css.deleteStatus} tone="loading">{t('delete.pending')}</StatusLine>}
      {deleteError !== null && <FieldError className={css.renameError}>{deleteError}</FieldError>}
    </Modal>
  )
}