/**
 * The built-in file viewer declarations (binary-download / html / markdown /
 * text), contributed through the same {@linkcode DesktopSidebarService.register}
 * face external plugins use. The text viewer is the catch-all (`exts: []`,
 * lowest priority) that claims any file no other viewer did; the binary
 * viewer sniffs NUL bytes via `detect`.
 */
import { BinaryFileViewer, HtmlFileViewer } from '../files/file-viewers.tsx'
import { ContentViewer } from '../files/content-viewer.tsx'
import type { SidebarSurfaceDescriptor } from '../contract.ts'
import type { SidebarBuiltinDeps } from './deps.ts'

/** A viewer-aspect declaration awaiting kind-level unification. */
export type ViewerPart = Pick<SidebarSurfaceDescriptor, 'kind' | 'viewer' | 'scopeNeed' | 'previewable' | 'focusPolicy'>

/** The built-in viewer declarations (descending priority). */
export function builtinViewers(deps: SidebarBuiltinDeps): readonly ViewerPart[] {
  const { t } = deps
  return [
    {
      kind: 'binary',
      viewer: {
        detect: (_path, head) => head.includes(0),
        exts: [],
        fetchStrategy: 'binary-download',
        priority: 100,
        render: input => (
          <BinaryFileViewer
            onOpen={async () => { await deps.openExternalPath(input.path) }}
            path={input.path}
            title={input.title}
            t={t}
          />
        ),
        title: () => t('files.viewer.binary'),
      },
      scopeNeed: null,
      previewable: false,
      focusPolicy: 'never',
    },
    {
      kind: 'html',
      viewer: {
        exts: ['html', 'htm'],
        fetchStrategy: 'fsRead',
        priority: 30,
        // The sandbox switches ride the top-level "Opening behavior" section
        // (both are dangerous — the copy warns); the gear holds detail rows
        // only, and html has none.
        render: input => (
          <HtmlFileViewer
            content={input.content ?? ''}
            path={input.path}
            title={input.title}
            runtime={deps.runtimeSettings}
            t={t}
          />
        ),
        title: () => t('files.viewer.html'),
      },
      scopeNeed: null,
      previewable: false,
      focusPolicy: 'never',
    },
    {
      kind: 'markdown',
      viewer: {
        exts: ['md', 'markdown', 'mdx'],
        fetchStrategy: 'fsRead',
        priority: 20,
        render: input => (
          <ContentViewer
            path={input.path}
            content={input.content ?? null}
            binary={false}
            {...(input.scope?.cwd === undefined ? {} : { cwd: input.scope.cwd })}
            sessions={deps.sessions}
            t={t}
          />
        ),
        title: () => t('files.viewer.markdown'),
      },
      scopeNeed: null,
      previewable: false,
      focusPolicy: 'never',
    },
    {
      kind: 'text',
      viewer: {
        exts: [],
        fetchStrategy: 'fsRead',
        priority: -100,
        render: input => (
          <ContentViewer
            path={input.path}
            content={input.content ?? null}
            binary={false}
            {...(input.scope?.cwd === undefined ? {} : { cwd: input.scope.cwd })}
            sessions={deps.sessions}
            t={t}
          />
        ),
        title: () => t('files.viewer.text'),
      },
      scopeNeed: null,
      previewable: false,
      focusPolicy: 'never',
    },
  ]
}
