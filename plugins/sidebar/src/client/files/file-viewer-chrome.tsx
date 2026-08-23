/**
 * File surface header: project › …dirs › file breadcrumb + Markdown
 * Source/Preview mode switch + auxiliary actions. Ported from Synara
 * `features/file-viewer/file-viewer-chrome.tsx` and adapted to the DSH
 * CSS-token environment (no Tailwind classes).
 *
 * The strip itself is the shared SurfaceToolbar — the same geometry the
 * editor and diff states render through, so switching modes never swaps
 * chrome.
 */
import { Fragment, useMemo } from 'react'
import type { Translate } from '@dsh-studio/shared/i18n'
import { basename } from '@dsh-studio/shared/path'
import { ModeSwitch, SurfaceToolbar, ToolbarAction } from '@dsh-studio/shared/ui'
import type { WorkspaceMessage } from '../i18n.ts'
import {
  IconChevronRight,
  IconEdit,
  IconExternalLink,
  IconEye,
  IconFileText,
} from '@dsh-studio/shared/tabler-icons'

export type MarkdownViewMode = 'source' | 'preview'

export function FileViewerChrome({
  cwd,
  filePath,
  isMarkdown,
  markdownMode,
  onMarkdownModeChange,
  truncated = false,
  meta,
  onOpenExternal,
  onEdit,
  t,
}: {
  cwd: string
  filePath: string
  isMarkdown: boolean
  markdownMode: MarkdownViewMode
  onMarkdownModeChange(mode: MarkdownViewMode): void
  truncated?: boolean
  /** Single-line metadata, e.g. `123 lines` or `ts · 123 lines`. */
  meta?: string | null
  onOpenExternal?(): void
  onEdit?(): void
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const { prefixSegments, fileSegment } = useMemo(() => {
    const normalized = filePath.replace(/\\/g, '/')
    const root = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
    const projectName = root.length > 0 ? basename(root) : null
    const fileSegments = normalized.split('/').filter(segment => segment.length > 0)
    const segments = projectName !== null && !normalized.startsWith('/')
      ? [projectName, ...fileSegments]
      : fileSegments
    return {
      prefixSegments: segments.slice(0, -1).map((name, index) => ({
        name,
        key: segments.slice(0, index + 1).join('/'),
      })),
      fileSegment: segments.at(-1) ?? basename(filePath),
    }
  }, [cwd, filePath])

  const breadcrumb = (
    <nav
      className="dsh-studio-file-viewer-breadcrumb"
      aria-label="File path"
      title={filePath}
    >
      <span className="dsh-studio-file-viewer-breadcrumb-prefix">
        {prefixSegments.map(segment => (
          <Fragment key={segment.key}>
            <span className="dsh-studio-file-viewer-breadcrumb-segment">{segment.name}</span>
            <IconChevronRight className="dsh-studio-file-viewer-breadcrumb-chevron" size={12} />
          </Fragment>
        ))}
      </span>
      <span className="dsh-studio-file-viewer-breadcrumb-file">{fileSegment}</span>
    </nav>
  )
  const metaContent = (meta !== undefined && meta !== null) || truncated
    ? (
      <>
        {meta !== undefined && meta !== null && (
          <span className="dsh-studio-file-viewer-chrome-meta">{meta}</span>
        )}
        {truncated && (
          <span className="dsh-studio-file-viewer-chrome-meta dsh-studio-file-viewer-chrome-truncated">
            {t('files.partial')}
          </span>
        )}
      </>
    )
    : undefined
  const modeSwitch = isMarkdown
    ? (
      <ModeSwitch
        ariaLabel="Markdown view"
        value={markdownMode}
        onValueChange={onMarkdownModeChange}
        options={[
          { value: 'source', label: t('files.viewer.source'), icon: <IconFileText size={14} /> },
          { value: 'preview', label: t('files.viewer.preview'), icon: <IconEye size={14} /> },
        ]}
      />
    )
    : undefined
  const actions = onEdit !== undefined || onOpenExternal !== undefined
    ? (
      <>
        {onEdit !== undefined && (
          <ToolbarAction
            icon={<IconEdit size={14} />}
            label={t('files.edit')}
            onClick={onEdit}
          />
        )}
        {onOpenExternal !== undefined && (
          <ToolbarAction
            icon={<IconExternalLink size={14} />}
            label={t('files.open-externally')}
            onClick={onOpenExternal}
          />
        )}
      </>
    )
    : undefined

  return (
    <SurfaceToolbar
      className="dsh-studio-file-viewer-chrome"
      data-testid="file-viewer-chrome"
      leading={breadcrumb}
      meta={metaContent}
      modeSwitch={modeSwitch}
      actions={actions}
    />
  )
}
