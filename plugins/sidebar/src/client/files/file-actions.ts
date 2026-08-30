/**
 * FS mutation flows for the files browser (rename / copy / delete) plus the
 * explorer keyboard shortcuts (F2 rename, Delete remove). Extracted from
 * files-view.tsx — behavior unchanged.
 *
 * The three flows share ONE guard + alert tail (audit "三段合一"): each op
 * narrows cwd/scope/target, then delegates to `withFsOp` which owns the
 * "files.op-failed" alert. Duplication between rename/copy (prompt a new
 * name) and delete (confirm) stops at the shared mutation guard.
 */
import { useCallback, useEffect } from 'react'
import type { CapabilitiesScope } from '@dsh-studio/shared/capabilities-api'
import type { Translate } from '@dsh-studio/shared/i18n'
import { basename, dirname, joinPath } from '@dsh-studio/shared/path'
import { errorMessage } from '@dsh-studio/shared/errors'
import { sidebarApi } from '../sidebar-api.ts'
import { alertDialog, confirmDialog, promptDialog } from '../kit/dialog.tsx'
import { hasOpenMenuOrDialog } from '../surfaces/dsh-dom.ts'
import type { WorkspaceMessage } from '../i18n.ts'

export interface FileActionsDeps {
  cwd: string | undefined
  scope: CapabilitiesScope | null
  selectedPath: string | null
  active: boolean
  t: Translate<WorkspaceMessage>
  refreshListings(affectedPath?: string): void
}

export interface FileActions {
  renameFsEntry(target?: string | null): Promise<void>
  deleteFsEntry(target?: string | null): Promise<void>
  copyFsEntry(target?: string | null): Promise<void>
}

/** The explorer keyboard shortcuts stay inert while Chrome's own portaled
 *  menu/dialog is open; the probe lives in the single dsh-dom.ts module (C5),
 *  re-pinnable in one place on an upstream bump. */

/** Shared guard + alert tail for rename/copy/delete (audit 三段合一). */
async function withFsOp(
  cwd: string,
  scope: CapabilitiesScope,
  t: Translate<WorkspaceMessage>,
  perform: () => Promise<void>,
): Promise<void> {
  try {
    await perform()
  } catch (cause) {
    await alertDialog({
      title: t('files.op-failed'),
      message: errorMessage(cause),
      confirmLabel: t('dialog.ok'),
    })
  }
}

/** The F2/Delete & rename/copy/delete actions for one explorer instance. */
export function useFileActions(deps: FileActionsDeps): FileActions {
  const { cwd, scope, selectedPath, active, t, refreshListings } = deps

  const renameFsEntry = useCallback((target: string | null = selectedPath): Promise<void> => {
    if (cwd === undefined || scope == null || target === null) return Promise.resolve()
    const parent = dirname(target) || cwd
    return withFsOp(cwd, scope, t, async () => {
      const name = await promptDialog({
        title: t('files.rename-to'),
        defaultValue: basename(target),
        confirmLabel: t('dialog.ok'),
        cancelLabel: t('dialog.cancel'),
      })
      if (name === null || name.trim() === '') return
      await sidebarApi.fsRename(scope, target, joinPath(parent, name.trim()))
      refreshListings(parent)
    })
  }, [cwd, scope, selectedPath, t, refreshListings])

  const deleteFsEntry = useCallback((target: string | null = selectedPath): Promise<void> => {
    if (cwd === undefined || scope == null || target === null) return Promise.resolve()
    return withFsOp(cwd, scope, t, async () => {
      const confirmed = await confirmDialog({
        title: t('files.delete'),
        message: t('files.delete-confirm', { path: target }),
        confirmLabel: t('files.delete'),
        cancelLabel: t('dialog.cancel'),
        danger: true,
      })
      if (!confirmed) return
      await sidebarApi.fsDelete(scope, target)
      refreshListings(dirname(target))
    })
  }, [cwd, scope, selectedPath, t, refreshListings])

  const copyFsEntry = useCallback((target: string | null = selectedPath): Promise<void> => {
    if (cwd === undefined || scope == null || target === null) return Promise.resolve()
    const base = basename(target)
    const parent = dirname(target) || cwd
    return withFsOp(cwd, scope, t, async () => {
      const name = await promptDialog({
        title: t('files.copy-to'),
        defaultValue: `${base}.copy`,
        confirmLabel: t('dialog.ok'),
        cancelLabel: t('dialog.cancel'),
      })
      if (name === null || name.trim() === '') return
      await sidebarApi.fsCopy(scope, target, joinPath(parent, name.trim()))
      refreshListings(parent)
    })
  }, [cwd, scope, selectedPath, t, refreshListings])

  // Explorer keyboard shortcuts while the files tab is the active panel:
  // F2 renames the selected entry, Delete removes it (after confirmation).
  // Ignored while a menu or dialog is open, or when a text field is focused.
  // The handler is memoized so the window listener is bound once per dep set
  // instead of being torn down and rebound every render (C12).
  const handleFilesKeyDown = useCallback((event: KeyboardEvent): void => {
    const target = event.target
    if (target instanceof HTMLElement
      && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
        || target.tagName === 'SELECT' || target.isContentEditable)) {
      return
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return
    if (hasOpenMenuOrDialog()) return
    if (event.key === 'F2' && selectedPath !== null) {
      event.preventDefault()
      void renameFsEntry(selectedPath)
    } else if (event.key === 'Delete' && selectedPath !== null) {
      event.preventDefault()
      void deleteFsEntry(selectedPath)
    }
  }, [selectedPath, renameFsEntry, deleteFsEntry])

  useEffect(() => {
    if (!active || cwd === undefined || scope == null) return
    window.addEventListener('keydown', handleFilesKeyDown)
    return () => { window.removeEventListener('keydown', handleFilesKeyDown) }
  }, [active, cwd, scope, handleFilesKeyDown])

  return { renameFsEntry, deleteFsEntry, copyFsEntry }
}