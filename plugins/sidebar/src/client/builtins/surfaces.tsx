/**
 * The built-in center-surface renderers (file / diff / diff-all / commit /
 * commit-file / committed / conflict), registered through the service's
 * surface-renderer extension point — the middle-workbench analogue of
 * registerTab. The browser kind is deliberately NOT here: it is Electron-
 * bound and registers from the desktop enhancement plugin.
 */
import type { Translate } from '@dsh-studio/shared/i18n'
import type { WorkspaceMessage } from '../i18n.ts'
import type { DesktopSidebarService } from '../contract.ts'
import type { CenterSurface } from '../surfaces/types.ts'
import type { ReviewCommentsService } from '../review/review-comments.ts'
import { FileSurfaceView } from '../surfaces/file-surface.tsx'
import {
  DiffAllSurfaceView,
  DiffSurfaceView,
} from '../surfaces/diff-renderers.tsx'
import {
  CommitDiffSurfaceView,
  CommitFileSurfaceView,
  CommittedSurfaceView,
} from '../surfaces/commit-renderers.tsx'
import { ConflictSurfaceView } from '../surfaces/conflict-renderer.tsx'

/** Register every built-in surface renderer; returns the disposer. */
export function registerBuiltinSurfaces(
  sidebar: DesktopSidebarService,
  t: Translate<WorkspaceMessage>,
  reviewComments?: ReviewCommentsService,
): () => void {
  const disposers = [
    sidebar.registerSurfaceRenderer('file', surface => {
      if (surface.kind !== 'file') return null
      return (
        <FileSurfaceView
          surface={surface}
          t={t}
          {...(reviewComments === undefined ? {} : { reviewComments })}
        />
      )
    }),
    sidebar.registerSurfaceRenderer('diff', surface => {
      if (surface.kind !== 'diff') return null
      return <DiffSurfaceView surface={surface} t={t} />
    }),
    sidebar.registerSurfaceRenderer('diff-all', surface => {
      if (surface.kind !== 'diff-all') return null
      return <DiffAllSurfaceView surface={surface} t={t} />
    }),
    sidebar.registerSurfaceRenderer('commit', surface => {
      if (surface.kind !== 'commit') return null
      return <CommitDiffSurfaceView surface={surface} t={t} />
    }),
    sidebar.registerSurfaceRenderer('commit-file', surface => {
      if (surface.kind !== 'commit-file') return null
      return <CommitFileSurfaceView surface={surface} t={t} />
    }),
    sidebar.registerSurfaceRenderer('committed', surface => {
      if (surface.kind !== 'committed') return null
      return <CommittedSurfaceView surface={surface} t={t} />
    }),
    sidebar.registerSurfaceRenderer('conflict', surface => {
      if (surface.kind !== 'conflict') return null
      return <ConflictSurfaceView surface={surface} t={t} />
    }),
  ]
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}

export type { CenterSurface }
