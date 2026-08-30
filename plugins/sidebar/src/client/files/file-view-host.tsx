/**
 * Single-file viewer host (`FileView` body). Hosts the retained
 * WorkspaceFileRuntime read for the current tab resource, matches a
 * registered viewer on a sniff of the head bytes, and otherwise renders a
 * fallback with an explicit open action.
 *
 * C12: the snapshot is always derived per-path from the runtime's cache (so
 * a path change yields the new file's snapshot, never a stale older one) and
 * the fallback subtree is keyed by `path`, so switching files remounts the
 * viewer — old content can never flash for a new path. The runtime's own
 * read already rides an AbortController; the aborted/stale-response guard
 * for the search-style fetch lives in files-search.tsx.
 *
 * Extracted from files-view.tsx — behavior unchanged.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CapabilitiesScope } from '@dsh-studio/shared/capabilities-api'
import type { Translate } from '@dsh-studio/shared/i18n'
import { EmptyState, ErrorState, LoadingState, ScrollArea } from '@dsh-studio/shared/ui'
import type { DesktopSidebarService } from '../contract.ts'
import { getFileRuntime } from '../runtimes/registry.ts'
import type { WorkspaceMessage } from '../i18n.ts'
import { SidebarSurfaceCss as surfaceCss } from '../styles.js'
import { formatSize } from './files-tree.tsx'

/** Bytes sniffed from a file head for viewer detection. */
const VIEWER_SNIFF_BYTES = 512

export interface FileViewHostProps {
  cwd: string | undefined
  path: string | undefined
  title: string
  scope: CapabilitiesScope | null
  sidebar: DesktopSidebarService
  t: Translate<WorkspaceMessage>
  onOpenPath(path: string): Promise<void>
}

/** Render the current file's viewer (or a fallback with onOpenPath). */
export function FileViewHost({
  cwd,
  path,
  title,
  scope,
  sidebar,
  t,
  onOpenPath,
}: FileViewHostProps): JSX.Element {
  // Reads ride the retained WorkspaceFileRuntime (G4): the same per-path cache
  // the untracked-diff synthesis uses, so this plugin has ONE file-read path
  // instead of a bare fsRead mirror in the component.
  const runtime = useMemo(
    () => (scope === null || scope.cwd === undefined || path === undefined
      ? null
      : getFileRuntime({ cwd: scope.cwd })),
    [scope, path],
  )
  const fingerprint = useSyncExternalStore(
    useCallback((listener: () => void) => runtime?.subscribe(listener) ?? (() => {}), [runtime]),
    useCallback(() => runtime?.fingerprint() ?? 'none', [runtime]),
  )
  void fingerprint
  const entry = runtime === null || path === undefined ? undefined : runtime.getEntry(path)
  useEffect(() => {
    if (runtime === null || path === undefined) return
    void runtime.ensureLoaded(path)
  }, [runtime, path])

  if (cwd === undefined || path === undefined) {
    return <EmptyState className={surfaceCss["dsh-studio-side-empty"]} title={t('files.select-workspace')} />
  }
  if (entry !== undefined && entry.phase === 'error') {
    return <ErrorState message={entry.message ?? t('overlay.no-content')} />
  }
  // C12: snapshot derived strictly for the CURRENT path; `path` also keys the
  // fallback below so a tab switch never shows a previous file's data.
  const snapshot = entry !== undefined && entry.phase === 'ready' ? entry.snapshot : null
  if (snapshot === null) return <LoadingState label={t('files.loading')} />
  const head = snapshot.binary
    ? new Uint8Array([0])
    : new TextEncoder().encode((snapshot.content ?? '').slice(0, VIEWER_SNIFF_BYTES))
  const viewer = sidebar.matchViewer(path, head)
  const viewerSpec = viewer?.viewer
  if (viewerSpec?.render !== undefined) {
    return <>{viewerSpec.render({
      ...(snapshot.content !== null ? { content: snapshot.content } : {}),
      path,
      title,
      // The viewer needs the session scope for cwd-relative payloads
      // (the "add to conversation" selection popup).
      ...(scope === null || scope === undefined ? {} : { scope }),
    })}</>
  }
  return (
    <ScrollArea
      key={path}
      className={surfaceCss["dsh-studio-file-preview"]}
      viewportClassName="dsh-studio-ui-scroll-viewport-inset"
    >
      <div>
        <strong>{title}</strong>
        <Button variant="outline" size="sm" onClick={() => { void onOpenPath(path) }}>
          {t('files.open')}
        </Button>
      </div>
      <EmptyState title={t('files.no-viewer', { size: formatSize(snapshot.size) })} />
    </ScrollArea>
  )
}