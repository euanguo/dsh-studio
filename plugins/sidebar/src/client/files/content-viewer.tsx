/**
 * File content viewer migrated from the reference project's
 * content-viewer.tsx: routes by extension to text (numbered lines), CSV/TSV
 * (table), markdown (react-markdown), binary (open-externally placeholder),
 * image/PDF (inline preview + toolbar), and empty states. Rendering stays
 * inside the detached panel / file tab.
 *
 * P1 upgrades: large-file graded fallbacks (250k highlight / 20k line-number
 * caps), image loading/error/zoom states, PDF toolbar, sticky CSV header,
 * differentiated binary states, and truncated propagation for write-gating.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  IconExternalLink,
  IconFileText,
  IconMinus,
  IconPlus,
} from '../../../../shared/tabler-icons.tsx'
import type { Translate } from '../../../../shared/i18n.ts'
import { basename } from '../../../../shared/path.ts'
import type { WorkspaceMessage } from '../i18n.ts'
import { Scrollable } from '../../../../shared/scrollable.tsx'
import { isPlainLanguage, languageForPath, MAX_NUMBERED_LINES } from './language.ts'
import { PierreFileView } from './pierre-file-view.tsx'
import { detectDelimiter, parseDelimitedRows } from './delimited-text.ts'
import { MarkdownViewer } from './markdown-viewer.tsx'
import { IpynbViewer } from './ipynb-viewer.tsx'
import { MermaidViewer } from './mermaid-viewer.tsx'
import { SelectionInsertPopup } from './selection-insert-popup.tsx'
import type { ReviewCommentsService } from '../review/review-comments.ts'
import type { DiffComment } from '../diff/diff-comments-store.ts'

type ContentKind = 'text' | 'csv' | 'markdown' | 'html' | 'image' | 'pdf' | 'ipynb' | 'mermaid' | 'binary'

const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'svg', 'avif',
])

function detectKind(path: string, binary: boolean): ContentKind {
  const dot = path.lastIndexOf('.')
  const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : ''
  // Binary-but-previewable kinds win over the generic binary placeholder.
  if (ext === 'pdf') return 'pdf'
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (binary) return 'binary'
  if (ext === 'csv' || ext === 'tsv') return 'csv'
  if (ext === 'ipynb') return 'ipynb'
  if (ext === 'mmd' || ext === 'mermaid') return 'mermaid'
  if (ext === 'md' || ext === 'markdown' || ext === 'mdx') return 'markdown'
  if (ext === 'html' || ext === 'htm') return 'html'
  return 'text'
}

function mimeFor(path: string): string {
  const dot = path.lastIndexOf('.')
  const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : ''
  const table: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    ico: 'image/x-icon',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    avif: 'image/avif',
    pdf: 'application/pdf',
  }
  return table[ext] ?? 'application/octet-stream'
}

function formatBytes(size: number): string {
  if (size < 1024) return `${String(size)} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

/** Newline-count line total without allocating the full line array. */
function countLineBreaks(text: string): number {
  let count = 1
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) count += 1
  }
  return count
}

export interface ContentViewerProps {
  path: string
  content: string | null
  binary: boolean
  size?: number
  truncated?: boolean
  /** Full base64 payload for binary previews (images / PDFs). */
  data?: string
  /** For Markdown: rendered preview vs source. */
  markdownPreview?: boolean
  /** Line comments shown as annotation rows in Pierre code views. */
  comments?: readonly DiffComment[]
  /** Session cwd (relative "add to conversation" payloads). */
  cwd?: string
  /** When given, text/markdown selections offer an "add to conversation"
   *  popup appended into the composer through this service. */
  reviewComments?: ReviewCommentsService
  onTaskToggle?(input: { sourceLine: number; checked: boolean }): void
  onOpenExternal?(): void
  onShowInFolder?(): void
  t: Translate<WorkspaceMessage>
}

export function ContentViewer({
  path,
  content,
  binary,
  size,
  truncated = false,
  data,
  markdownPreview = true,
  comments,
  cwd,
  reviewComments,
  onTaskToggle,
  onOpenExternal,
  onShowInFolder,
  t,
}: ContentViewerProps): JSX.Element {
  const kind = detectKind(path, binary)
  const name = basename(path)
  // The selection-insert popup host: the markdown preview (its Scrollable)
  // and the Pierre code/plain rows share ONE ref — only one branch renders
  // at a time. Rendered inline so its document listeners reset when the
  // opened file changes.
  const textRootRef = useRef<HTMLDivElement | null>(null)
  const selectionInsert = reviewComments === undefined || content === null ? null : (
    <SelectionInsertPopup
      containerRef={textRootRef}
      path={path}
      cwd={cwd}
      content={content}
      onAddSelection={text => reviewComments.appendToComposer(text)}
      t={t}
    />
  )

  // Heavy per-content derivations, computed once per content change instead
  // of once per render (rail resizes / tab switches re-render this view).
  const lineCount = useMemo(
    () => (content === null ? 0 : countLineBreaks(content)),
    [content],
  )
  const csvTable = useMemo(() => {
    // Only meaningful for the csv branch; other kinds get an inert default.
    if (kind !== 'csv' || content === null) {
      return { delimiter: '\t', rows: [] as ReturnType<typeof parseDelimitedRows> }
    }
    const delimiter = detectDelimiter(path, content)
    return { delimiter, rows: parseDelimitedRows(content, delimiter) }
  }, [kind, path, content])

  if (kind === 'image' && data !== undefined) {
    return (
      <ImageViewer
        path={path}
        data={data}
        mime={mimeFor(path)}
        t={t}
        {...(onOpenExternal === undefined ? {} : { onOpenExternal })}
      />
    )
  }

  if (kind === 'pdf' && data !== undefined) {
    return (
      <PdfViewer
        path={path}
        data={data}
        {...(onOpenExternal === undefined ? {} : { onOpenExternal })}
      />
    )
  }

  if (kind === 'html' && content !== null) {
    return (
      <div className="oh-dsh-content-html">
        <iframe title={name} sandbox="" srcDoc={content} />
      </div>
    )
  }

  if (kind === 'binary') {
    const isEmpty = size !== undefined && size === 0
    return (
      <div className="oh-dsh-content-empty" data-kind={isEmpty ? 'empty' : 'binary'}>
        <IconFileText size={20} />
        <strong>{name}</strong>
        <span>{isEmpty ? t('files.empty-file') : t('files.viewer.binary')}</span>
        {onOpenExternal !== undefined && (
          <button type="button" onClick={onOpenExternal}>{t('files.open')}</button>
        )}
      </div>
    )
  }

  if (content === null) {
    return (
      <div className="oh-dsh-content-empty" data-kind="unavailable">
        <IconFileText size={20} />
        <strong>{name}</strong>
        <span>{t('overlay.no-content')}</span>
      </div>
    )
  }

  if (content.length === 0) {
    return (
      <div className="oh-dsh-content-empty" data-kind="empty">
        <IconFileText size={20} />
        <strong>{name}</strong>
        <span>{t('files.empty-file')}</span>
      </div>
    )
  }

  if (kind === 'ipynb') {
    return (
      <div className="oh-dsh-content-root">
        <IpynbViewer content={content} />
      </div>
    )
  }

  if (kind === 'mermaid') {
    return (
      <div className="oh-dsh-content-root">
        <MermaidViewer content={content} t={t} />
      </div>
    )
  }

  if (kind === 'markdown') {
    if (markdownPreview) {
      return (
        <>
          <MarkdownViewer
            containerRef={textRootRef}
            content={content}
            taskTogglesEnabled={!truncated}
            {...(onTaskToggle === undefined ? {} : { onTaskToggle })}
          />
          {selectionInsert}
        </>
      )
    }
    const showLineNumbers = lineCount <= MAX_NUMBERED_LINES
    return (
      <div className="oh-dsh-content-root oh-dsh-content-root-fill">
        <div className="oh-dsh-content-meta">
          <span>{name}</span>
          <span>{`markdown · ${lineCount} lines`}</span>
          {truncated ? <span>{t('files.preview-truncated')}</span> : null}
        </div>
        <PierreFileView
          path={path}
          content={content}
          language="markdown"
          lineNumbers={showLineNumbers}
          cacheKey={path}
          {...(comments === undefined ? {} : { comments })}
        />
      </div>
    )
  }

  if (kind === 'csv') {
    return (
      <div className="oh-dsh-content-root">
        <div className="oh-dsh-content-meta">
          <span>{csvTable.delimiter === '\t' ? 'tsv' : 'csv'}</span>
          <span>{`${Math.max(csvTable.rows.length - 1, 0)} rows`}</span>
          {size === undefined ? '' : formatBytes(size)}
          {truncated ? <span>{t('files.preview-truncated')}</span> : null}
        </div>
        <CsvVirtualTable rows={csvTable.rows} />
      </div>
    )
  }

  // Every plain-text kind (code, unknown extension, oversized) renders
  // through the same Pierre File component — one viewer family, no custom
  // plain renderer. Unknown languages pass lang 'text' (plain rows with
  // line numbers, same chrome as highlighted files).
  const language = languageForPath(path)
  const showLineNumbers = lineCount <= MAX_NUMBERED_LINES
  return (
    <div ref={textRootRef} className="oh-dsh-content-root oh-dsh-content-root-fill">
      <div className="oh-dsh-content-meta">
        <span>{name}</span>
        <span>{isPlainLanguage(language) ? `${lineCount} lines` : `${language} · ${lineCount} lines`}</span>
        {truncated ? <span>{t('files.preview-truncated')}</span> : null}
      </div>
      <PierreFileView
        path={path}
        content={content}
        language={language}
        lineNumbers={showLineNumbers}
        cacheKey={path}
        {...(comments === undefined ? {} : { comments })}
      />
      {selectionInsert}
    </div>
  )
}

function CsvVirtualTable({ rows }: { rows: string[][] }): JSX.Element {
  const parentRef = useRef<HTMLDivElement | null>(null)
  const header = rows[0] ?? []
  const body = rows.slice(1)
  const virtualizer = useVirtualizer({
    count: body.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 24,
    overscan: 12,
  })
  const items = virtualizer.getVirtualItems()
  const topSpacer = items[0]?.start ?? 0
  const bottomSpacer = Math.max(0, virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0))
  return (
    <Scrollable axis="both" className="oh-dsh-content-table-wrap" ref={parentRef}>
      <table className="oh-dsh-content-table oh-dsh-content-table-virtual">
        {header.length > 0 ? (
          <thead>
            <tr>
              {header.map((cell, index) => <th key={`h-${index}`}>{cell}</th>)}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {topSpacer > 0 ? <tr aria-hidden="true"><td style={{ height: topSpacer, padding: 0 }} /></tr> : null}
          {items.map(item => {
            const row = body[item.index] ?? []
            return (
              <tr key={`r-${item.key}`} data-index={item.index} ref={virtualizer.measureElement}>
                {row.map((cell, cellIndex) => <td key={`c-${item.index}-${cellIndex}`}>{cell}</td>)}
              </tr>
            )
          })}
          {bottomSpacer > 0 ? <tr aria-hidden="true"><td style={{ height: bottomSpacer, padding: 0 }} /></tr> : null}
        </tbody>
      </table>
    </Scrollable>
  )
}

function ImageViewer({
  path,
  data,
  mime,
  t,
  onOpenExternal,
}: {
  path: string
  data: string
  mime: string
  t: Translate<WorkspaceMessage>
  onOpenExternal?(): void
}): JSX.Element {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [zoom, setZoom] = useState(1)
  const name = basename(path)

  useEffect(() => {
    setStatus('loading')
    setZoom(1)
  }, [path, data])

  return (
    <div className="oh-dsh-content-media" data-status={status}>
      {status === 'error' ? (
        <div className="oh-dsh-content-empty">
          <IconFileText size={20} />
          <strong>{name}</strong>
          <span>{t('files.image-load-failed')}</span>
          {onOpenExternal !== undefined && (
            <button type="button" onClick={onOpenExternal}>{t('files.open')}</button>
          )}
        </div>
      ) : (
        <>
          <div className="oh-dsh-image-toolbar">
            <button type="button" onClick={() => setZoom(value => Math.max(0.25, value - 0.25))} aria-label={t('files.zoom-out')}>
              <IconMinus size={14} />
            </button>
            <span>{`${Math.round(zoom * 100)}%`}</span>
            <button type="button" onClick={() => setZoom(value => Math.min(8, value + 0.25))} aria-label={t('files.zoom-in')}>
              <IconPlus size={14} />
            </button>
            <button type="button" onClick={() => setZoom(1)}>{t('files.zoom-reset')}</button>
            {onOpenExternal !== undefined ? (
              <button type="button" onClick={onOpenExternal} aria-label={t('files.open-externally')}>
                <IconExternalLink size={14} />
              </button>
            ) : null}
          </div>
          <Scrollable axis="both" className="oh-dsh-content-media-stage">
            {status === 'loading' ? <span className="oh-dsh-side-muted">{t('files.image-loading')}</span> : null}
            <img
              src={`data:${mime};base64,${data}`}
              alt={name}
              loading="lazy"
              decoding="async"
              style={{ transform: `scale(${zoom})` }}
              onLoad={() => setStatus('ready')}
              onError={() => setStatus('error')}
            />
          </Scrollable>
        </>
      )}
    </div>
  )
}

function PdfViewer({
  path,
  data,
  onOpenExternal,
}: {
  path: string
  data: string
  onOpenExternal?(): void
}): JSX.Element {
  const name = basename(path)
  return (
    <div className="oh-dsh-content-media">
      <div className="oh-dsh-pdf-toolbar">
        <span title={path}>{name}</span>
        {onOpenExternal !== undefined ? (
          <button type="button" onClick={onOpenExternal} aria-label="Open externally">
            <IconExternalLink size={14} />
          </button>
        ) : null}
      </div>
      <iframe title={name} src={`data:application/pdf;base64,${data}`} />
    </div>
  )
}
