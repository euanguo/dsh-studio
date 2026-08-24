/**
 * Center surface renderer for the MERGE-CONFLICT resolver (one conflicted
 * file, git UU/AA/DD). Content rides the retained file runtime; resolving
 * writes through the sidebar API, stages the file and swaps the tab to the
 * plain file view.
 */
import { SidebarSurfaceCss as surfaceCss } from '../styles.js'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@dsh-studio/shared/i18n'
import { toast } from '@dsh-studio/shared/toast'
import type { WorkspaceMessage } from '../i18n.ts'
import { sidebarApi } from '../sidebar-api.ts'
import type { FileContents, MergeConflictResolution } from '@pierre/diffs'
import { UnresolvedFile, Virtualizer } from '@pierre/diffs/react'
import { getFileRuntime, getSourceControlRuntime } from '../runtimes/registry.ts'
import { basename, resolveCapabilitiesPath } from '@dsh-studio/shared/path'
import { useCenterSurfaceStore } from './center-surface-store.ts'
import { ErrorState, LoadingState, SurfaceToolbar } from '@dsh-studio/shared/ui'
import { resolveConflictRegionContents } from '../diff/merge-conflict-resolve.ts'
import { usePierreDiffTheme } from '../diff/pierre-adapter.tsx'
import type { ConflictCenterSurface } from './types.ts'
import type { SessionsService } from '../client-types.ts'
import { useSelectionActionOverlay } from '../selection/use-selection-action.tsx'

/* ---------- merge conflict resolver ---------- */

/**
 * Merge-conflict resolver for one conflicted file (git UU/AA/DD). Renders the
 * raw file through @pierre/diffs' UnresolvedFile — conflict markers become
 * region renders with accept actions; accepting writes the resolved content
 * to disk, stages the file (marking it resolved) and swaps the tab to the
 * normal file view.
 *
 * The actions render through `renderMergeConflictUtility`: the react wrapper
 * always installs its own `onMergeConflictAction` state sync (which makes the
 * `onMergeConflictResolve` option unusable), so buttons route through the
 * instance's `handleMergeConflictActionClick` — that path re-renders the
 * region AND syncs the wrapper's React state. The resolved FileContents come
 * from `instance.resolveConflict(...)` before the click handler runs.
 */
export function ConflictSurfaceView({
  surface,
  t,
  sessions,
}: {
  surface: ConflictCenterSurface
  t: Translate<WorkspaceMessage>
  sessions?: SessionsService
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const theme = usePierreDiffTheme()
  const name = basename(surface.filePath)
  // The Git panel hands over git-relative paths; fs.* wire calls want absolute.
  const absolutePath = resolveCapabilitiesPath(surface.cwd, surface.filePath)

  // Content rides the retained file runtime cache (M6 — one read path).
  const runtime = useMemo(
    () => getFileRuntime({ cwd: surface.cwd }),
    [surface.cwd],
  )
  useSyncExternalStore(runtime.subscribe, runtime.fingerprint)
  const entry = runtime.getEntry(absolutePath)
  useEffect(() => {
    void runtime.ensureLoaded(absolutePath)
  }, [runtime, absolutePath])
  const content = entry !== undefined && entry.phase === 'ready'
    && entry.snapshot?.kind === 'text'
    ? entry.snapshot.content
    : null

  const onResolved = useCallback((resolved: FileContents) => {
    setBusy(true)
    sidebarApi.fsWrite(
      { cwd: surface.cwd },
      absolutePath,
      resolved.contents,
    ).then(() => sidebarApi.gitStage(
      { cwd: surface.cwd },
      surface.filePath,
    )).then(() => {
      // Refresh file + git state, then swap this tab for the plain file view.
      getFileRuntime({ cwd: surface.cwd }).invalidate(absolutePath)
      void getSourceControlRuntime({ cwd: surface.cwd }).refresh()
      const store = useCenterSurfaceStore.getState()
      store.close(surface.cwd, surface.id)
      store.openFile({
        cwd: surface.cwd,
        filePath: absolutePath,
        title: name,
        preview: false,
      })
    }).catch((cause: unknown) => {
      setBusy(false)
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      toast(t('toast.save-failed', { message }))
    })
  }, [absolutePath, surface.cwd, surface.filePath, surface.id, name, t])

  const file = useMemo<FileContents>(() => ({
    name,
    contents: content ?? '',
    cacheKey: `conflict:${surface.filePath}`,
  }), [content, name, surface.filePath])
  const selectionAction = useSelectionActionOverlay({
    containerRef: hostRef,
    path: surface.filePath,
    cwd: surface.cwd,
    content,
    layer: typeof window === 'undefined' ? null : window.document.body,
    sessions: sessions ?? null,
    t,
  })

  if (error !== '') return <ErrorState message={error} />
  if (entry !== undefined && entry.phase === 'error') {
    return <ErrorState message={entry.message ?? t('overlay.no-content')} />
  }
  if (entry !== undefined && entry.phase === 'ready' && entry.snapshot !== null && entry.snapshot.kind !== 'text') {
    return <ErrorState message={t('files.viewer.binary')} />
  }
  if (content === null) return <LoadingState label={t('overlay.loading')} />
  return (
    <div className={surfaceCss["dsh-studio-conflict-surface"]} data-testid="conflict-surface">
      <SurfaceToolbar
        className={surfaceCss["dsh-studio-conflict-header"]}
        leading={<span className={surfaceCss["dsh-studio-conflict-title"]} title={surface.filePath}>{name}</span>}
        meta={<small>Merge conflict</small>}
        actions={(
          <Button variant="primary" size="sm" disabled={busy}>
            {busy ? t('conflict.resolving') : t('conflict.resolve-and-stage')}
          </Button>
        )}
      />
      <div className={surfaceCss["dsh-studio-conflict-hint"]}>Choose a resolution below for each conflicted region.</div>
      <div ref={hostRef} className={`dsh-studio-conflict-host-wrap`}>
      {selectionAction.overlay}
      <Virtualizer className={surfaceCss["dsh-studio-conflict-host"]}>
        <UnresolvedFile
          file={file}
          options={{ disableFileHeader: true, theme }}
          renderMergeConflictUtility={(action, getInstance) => {
            const resolve = (resolution: MergeConflictResolution): void => {
              // The react wrapper does not hydrate the original file, so the
              // instance's own resolveConflict returns empty contents — build
              // the resolved text ourselves (same split semantics).
              const resolvedContents = resolveConflictRegionContents(content, action.conflict, resolution)
              const instance = getInstance()
              if (instance !== undefined) {
                // Re-renders the region and syncs the react wrapper state.
                // (Runtime-public field; the .d.ts marks it private.)
                const clickHandle = instance as unknown as {
                  handleMergeConflictActionClick(target: { conflictIndex: number; resolution: MergeConflictResolution }): void
                }
                clickHandle.handleMergeConflictActionClick({ conflictIndex: action.conflictIndex, resolution })
              }
              void onResolved({ name, contents: resolvedContents, cacheKey: `conflict:${surface.filePath}` })
            }
            return (
              <div className={`dsh-studio-conflict-actions`}>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => { resolve('current') }}>
                  {t('conflict.accept-current')}
                </Button>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => { resolve('incoming') }}>
                  {t('conflict.accept-incoming')}
                </Button>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => { resolve('both') }}>
                  {t('conflict.keep-both')}
                </Button>
              </div>
            )
          }}
        />
      </Virtualizer>
      </div>
    </div>
  )
}

