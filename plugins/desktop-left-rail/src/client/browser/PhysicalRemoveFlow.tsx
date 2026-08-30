/**
 * Physical worktree-removal flow for a registration-less (unregistered) Git
 * worktree: removing the workspace IS removing the worktree. Fetches the
 * dirty/locked preview when a target opens and renders the RiskConfirmation
 * (or the preview-error Modal). Releasing every registration under the path
 * and the rail controller's physical removal share the deleteWorkspace cleanup.
 */
import { useEffect, useState } from 'react'
import { Button, Modal, RiskConfirmation } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import { FieldError } from '@dsh-studio/shared/ui'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { RailController } from '../rail-controller.ts'
import type { WorktreeRemovalPreview } from '../worktree-api.ts'
import { WorkspaceBrowserCss as css } from '../styles.ts'
import { toast } from '@dsh-studio/shared/toast'
import { errorMessage } from '@dsh-studio/shared/errors'

export interface PhysicalRemoveTarget {
  repoRoot: string
  path: string
  workspaceIds: WorkspaceId[]
  workspaceCount: number
  sessionCount: number
}

export function PhysicalRemoveFlow({
  target,
  onClose,
  railController,
  deleteWorkspace,
  t,
}: {
  target: PhysicalRemoveTarget | null
  onClose: () => void
  railController: RailController
  deleteWorkspace: (workspaceId: WorkspaceId) => Promise<void>
  t: WorkspaceBrowserProps['t']
}): JSX.Element {
  const [preview, setPreview] = useState<WorktreeRemovalPreview | null>(null)
  const [pending, setPending] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // New target opens: reset and fetch the dirty/locked preview.
  useEffect(() => {
    if (target === null) return
    setPreview(null)
    setAcknowledged(false)
    setPending(false)
    setError(null)
    void railController.previewPhysicalWorktree(target.repoRoot, target.path).then(setPreview)
      .catch(reason => { setError(errorMessage(reason)) })
  }, [target])

  const close = (): void => {
    if (pending) return
    onClose()
  }
  const confirm = (): void => {
    if (pending || target === null || preview === null) return
    setPending(true)
    setError(null)
    const cont = target
    void railController.removePhysicalWorktree(
      cont.repoRoot,
      cont.path,
      preview.dirty || preview.locked,
    ).then(async () => {
      // Worktree = workspace: the physical removal also releases the
      // registrations that lived under it.
      const cleanup = await Promise.allSettled(
        cont.workspaceIds.map(id => deleteWorkspace(id as WorkspaceId)),
      )
      const failed = cleanup.filter(result => result.status === 'rejected').length
      setPending(false)
      setPreview(null)
      setError(null)
      setAcknowledged(false)
      if (failed > 0) toast(t('worktree.remove.cleanupFailed', { count: failed }))
      onClose()
    }).catch(reason => {
      setPending(false)
      setError(errorMessage(reason))
    })
  }

  return (
    <>
      <RiskConfirmation
        open={target !== null && preview !== null}
        title={t('worktree.removePhysical')}
        description={target === null || preview === null
          ? ''
          : t('worktree.removePhysical.desc', {
            path: target.path,
            workspaces: target.workspaceCount,
            sessions: target.sessionCount,
            dirty: preview.dirty ? t('worktree.removePhysical.dirty') : '',
          })}
        acknowledgeLabel={t('worktree.removePhysical.ack')}
        cancelLabel={t('cancel')}
        confirmLabel={pending ? t('worktree.removePhysical.pending') : t('worktree.removePhysical.confirm')}
        acknowledged={acknowledged}
        disabled={pending}
        onAcknowledgedChange={setAcknowledged}
        onCancel={close}
        onConfirm={confirm}
      />
      {target !== null && preview === null && error !== null && (
        <Modal
          open
          onClose={close}
          closeLabel={t('close')}
          title={t('worktree.removePhysical')}
          footer={<Button variant="outline" onClick={close}>{t('close')}</Button>}
        >
          <FieldError className={css.renameError}>{error}</FieldError>
        </Modal>
      )}
    </>
  )
}