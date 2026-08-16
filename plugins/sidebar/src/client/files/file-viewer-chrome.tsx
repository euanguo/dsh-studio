/**
 * File surface header: project › …dirs › file breadcrumb + Markdown
 * Source/Preview toggle + auxiliary actions. Ported from Synara
 * `features/file-viewer/file-viewer-chrome.tsx` and adapted to the DSH
 * CSS-token environment (no Tailwind classes).
 */
import { Fragment, useMemo } from 'react'
import type { Translate } from '../../../../shared/i18n.ts'
import { basename } from '../../../../shared/path.ts'
import type { WorkspaceMessage } from '../i18n.ts'
import {
  IconChevronRight,
  IconEdit,
  IconExternalLink,
  IconEye,
  IconFileText,
} from '../../../../shared/tabler-icons.tsx'

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

  return (
    <div className="oh-dsh-file-viewer-chrome" data-testid="file-viewer-chrome">
      <nav className="oh-dsh-file-viewer-breadcrumb" aria-label="File path" title={filePath}>
        <span className="oh-dsh-file-viewer-breadcrumb-prefix">
          {prefixSegments.map(segment => (
            <Fragment key={segment.key}>
              <span className="oh-dsh-file-viewer-breadcrumb-segment">{segment.name}</span>
              <IconChevronRight className="oh-dsh-file-viewer-breadcrumb-chevron" size={12} />
            </Fragment>
          ))}
        </span>
        <span className="oh-dsh-file-viewer-breadcrumb-file">{fileSegment}</span>
      </nav>

      {meta !== undefined && meta !== null ? (
        <span className="oh-dsh-file-viewer-chrome-meta">{meta}</span>
      ) : null}
      {truncated ? (
        <span className="oh-dsh-file-viewer-chrome-meta oh-dsh-file-viewer-chrome-truncated">
          {t('files.partial')}
        </span>
      ) : null}

      {isMarkdown ? (
        <div className="oh-dsh-file-viewer-mode-switch" role="radiogroup" aria-label="Markdown view">
          {(
            [
              { mode: 'source', label: t('files.viewer.source'), title: t('files.viewer.source'), Icon: IconFileText },
              { mode: 'preview', label: t('files.viewer.preview'), title: t('files.viewer.preview'), Icon: IconEye },
            ] as const
          ).map(segment => {
            const selected = segment.mode === markdownMode
            const Icon = segment.Icon
            return (
              <button
                key={segment.mode}
                type="button"
                role="radio"
                aria-checked={selected}
                title={segment.title}
                className={`oh-dsh-file-viewer-mode-button${selected ? ' is-selected' : ''}`}
                onClick={() => { onMarkdownModeChange(segment.mode) }}
              >
                <Icon size={14} />
                <span>{segment.label}</span>
              </button>
            )
          })}
        </div>
      ) : null}

      {onEdit !== undefined ? (
        <button
          type="button"
          className="oh-dsh-file-viewer-chrome-action"
          title={t('files.edit')}
          onClick={onEdit}
        >
          <IconEdit size={14} />
        </button>
      ) : null}

      {onOpenExternal !== undefined ? (
        <button
          type="button"
          className="oh-dsh-file-viewer-chrome-action"
          title={t('files.open-externally')}
          onClick={onOpenExternal}
        >
          <IconExternalLink size={14} />
        </button>
      ) : null}
    </div>
  )
}
