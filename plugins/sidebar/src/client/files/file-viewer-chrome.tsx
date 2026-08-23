/**
 * File surface header: project › …dirs › file breadcrumb + Markdown
 * Source/Preview icon toggle + auxiliary actions. Ported from Synara
 * `features/file-viewer/file-viewer-chrome.tsx` and adapted to the DSH
 * CSS-token environment (no Tailwind classes).
 *
 * The strip is the shared SurfaceToolbar and stays mounted across the
 * view ↔ edit swap: ONE icon toggle owns the state (pencil invites
 * editing, the engaged eye returns to the view), the breadcrumb and meta
 * never change, and the toolbar owns all typography — this module passes
 * plain content only.
 */
import { Fragment, useMemo } from 'react'
import type { Translate } from '@dsh-studio/shared/i18n'
import { basename } from '@dsh-studio/shared/path'
import { SurfaceToolbar, ToolbarAction } from '@dsh-studio/shared/ui'
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
  editing,
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
  /** Editing state: the SAME chrome stays mounted; the edit toggle swaps
   *  to its engaged "view" form and the dirty dot joins the meta slot. */
  editing?: {
    dirty: boolean
    onExit(): void
  }
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
  const metaContent = (meta !== undefined && meta !== null) || truncated || editing?.dirty === true
    ? (
      <>
        {meta !== undefined && meta !== null && meta}
        {truncated && (
          <span className="dsh-studio-file-viewer-chrome-truncated">
            {t('files.partial')}
          </span>
        )}
        {editing?.dirty === true && (
          <small className="dsh-studio-editor-dirty">●</small>
        )}
      </>
    )
    : undefined
  const modeSwitch = isMarkdown && editing === undefined
    ? (
      <ToolbarAction
        icon={markdownMode === 'preview' ? <IconEye size={14} /> : <IconFileText size={14} />}
        label={markdownMode === 'preview' ? t('files.viewer.source') : t('files.viewer.preview')}
        pressed={markdownMode === 'preview'}
        onClick={() => { onMarkdownModeChange(markdownMode === 'preview' ? 'source' : 'preview') }}
      />
    )
    : undefined
  // One icon toggle owns the view ↔ edit state: pencil invites editing,
  // the engaged eye returns to the view (exitToView flushes pending
  // changes — the same write path as autosave and Mod+S).
  const editToggle = editing !== undefined
    ? (
      <ToolbarAction
        icon={<IconEye size={14} />}
        label={t('files.view')}
        pressed
        onClick={editing.onExit}
      />
    )
    : onEdit !== undefined
    ? (
      <ToolbarAction
        icon={<IconEdit size={14} />}
        label={t('files.edit')}
        onClick={onEdit}
      />
    )
    : undefined
  const actions = (
    <>
      {editToggle}
      {onOpenExternal !== undefined && (
        <ToolbarAction
          icon={<IconExternalLink size={14} />}
          label={t('files.open-externally')}
          onClick={onOpenExternal}
        />
      )}
    </>
  )

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
