/**
 * The built-in center-workbench renderer declarations (file / diff /
 * diff-all / commit / commit-file / committed / conflict / terminal),
 * contributed through the same {@linkcode DesktopSidebarService.register}
 * face external plugins use. The browser kind is deliberately NOT here: it
 * is Electron-bound and registers from the desktop enhancement plugin.
 */
import type { Translate } from '@dsh-studio/shared/i18n'
import type { WorkspaceMessage } from '../i18n.ts'
import type { SidebarSurfaceDescriptor } from '../contract.ts'
import type { CenterSurface } from '../surfaces/types.ts'
import type { SessionsService } from '../client-types.ts'
import { useCenterSurfaceStore } from '../surfaces/center-surface-store.ts'
import type { SidebarRuntimeSettingsService } from '../runtime-settings.ts'
import { TerminalTabContent } from '../terminal-tab.tsx'
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

/** A center-aspect declaration awaiting kind-level unification. */
export type CenterPart = Pick<SidebarSurfaceDescriptor, 'kind' | 'center' | 'scopeNeed' | 'previewable' | 'focusPolicy'>

/** The built-in center renderer declarations (registration order). */
export function builtinSurfaces(
  t: Translate<WorkspaceMessage>,
  sessions: SessionsService | undefined,
  runtimeSettings: SidebarRuntimeSettingsService,
): readonly CenterPart[] {
  const withSessions = { ...(sessions === undefined ? {} : { sessions }) }
  return [
    {
      kind: 'file',
      center: {
        render: surface => {
          if (surface.kind !== 'file') return null
          return <FileSurfaceView surface={surface} t={t} {...withSessions} />
        },
      },
      scopeNeed: 'workspace',
      previewable: true,
      focusPolicy: 'never',
    },
    {
      kind: 'diff',
      center: {
        render: surface => {
          if (surface.kind !== 'diff') return null
          return <DiffSurfaceView surface={surface} t={t} {...withSessions} />
        },
      },
      scopeNeed: 'workspace',
      previewable: true,
      focusPolicy: 'never',
    },
    // These request kinds select a variant of the canonical `diff` surface;
    // they are registered so OpenPipeline resolves the same single table, but
    // their dispatcher creates the concrete `diff` surface for rendering.
    {
      kind: 'diff-staged',
      center: {},
      scopeNeed: 'workspace',
      previewable: true,
      focusPolicy: 'never',
    },
    {
      kind: 'diff-all',
      center: {
        render: surface => {
          if (surface.kind !== 'diff-all') return null
          return <DiffAllSurfaceView surface={surface} t={t} {...withSessions} />
        },
      },
      scopeNeed: 'workspace',
      previewable: true,
      focusPolicy: 'never',
    },
    {
      kind: 'diff-all-staged',
      center: {},
      scopeNeed: 'workspace',
      previewable: true,
      focusPolicy: 'never',
    },
    {
      kind: 'commit',
      center: {
        render: surface => {
          if (surface.kind !== 'commit') return null
          return <CommitDiffSurfaceView surface={surface} t={t} {...withSessions} />
        },
      },
      scopeNeed: 'workspace',
      previewable: true,
      focusPolicy: 'never',
    },
    {
      kind: 'commit-file',
      center: {
        render: surface => {
          if (surface.kind !== 'commit-file') return null
          return <CommitFileSurfaceView surface={surface} t={t} {...withSessions} />
        },
      },
      scopeNeed: 'workspace',
      previewable: true,
      focusPolicy: 'never',
    },
    {
      kind: 'committed',
      center: {
        render: surface => {
          if (surface.kind !== 'committed') return null
          return <CommittedSurfaceView surface={surface} t={t} {...withSessions} />
        },
      },
      scopeNeed: 'workspace',
      previewable: true,
      focusPolicy: 'never',
    },
    {
      // `committed-file` uses the canonical committed renderer after the
      // dispatcher decodes its base-ref/file-path target.
      kind: 'committed-file',
      center: {},
      scopeNeed: 'workspace',
      previewable: true,
      focusPolicy: 'never',
    },
    {
      kind: 'conflict',
      center: {
        render: surface => {
          if (surface.kind !== 'conflict') return null
          return <ConflictSurfaceView surface={surface} t={t} {...withSessions} />
        },
      },
      scopeNeed: 'workspace',
      previewable: true,
      focusPolicy: 'never',
    },
    {
      // First-class terminal (the middle "+" menu opens it): the same shared
      // TerminalTabContent the rail terminal tab renders.
      kind: 'terminal',
      center: {
        render: surface => {
          if (surface.kind !== 'terminal') return null
          return (
            <TerminalTabContent
              cwd={surface.cwd}
              tabId={surface.id}
              onTitleChange={title => {
                useCenterSurfaceStore.getState().updateSurfaceTitle(surface.cwd, surface.id, title)
              }}
              runtime={runtimeSettings}
              t={t}
            />
          )
        },
      },
      scopeNeed: 'workspace',
      previewable: false,
      focusPolicy: 'never',
    },
  ]
}

export type { CenterSurface }
