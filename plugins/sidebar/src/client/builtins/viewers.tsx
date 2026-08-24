/**
 * The built-in file viewer descriptors (binary-download / html / markdown /
 * text), registered through the same {@link DesktopSidebarService} external
 * plugins use. The text viewer is the catch-all (`exts: []`, lowest
 * priority) that claims any file no other viewer did; the binary viewer
 * sniffs NUL bytes via `detect`.
 */
import { BinaryFileViewer, HtmlFileViewer } from '../files/file-viewers.tsx'
import { ContentViewer } from '../files/content-viewer.tsx'
import type { SidebarViewerDescriptor } from '../contract.ts'
import type { SidebarBuiltinDeps } from './deps.ts'

/** The built-in viewer descriptors (descending priority). */
export function builtinViewers(deps: SidebarBuiltinDeps): readonly SidebarViewerDescriptor[] {
  const { t } = deps
  return [
    {
      detect: (_path, head) => head.includes(0),
      exts: [],
      fetchStrategy: 'binary-download',
      id: 'binary',
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
    {
      exts: ['html', 'htm'],
      fetchStrategy: 'fsRead',
      id: 'html',
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
    {
      exts: ['md', 'markdown', 'mdx'],
      fetchStrategy: 'fsRead',
      id: 'markdown',
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
    {
      exts: [],
      fetchStrategy: 'fsRead',
      id: 'text',
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
  ]
}
