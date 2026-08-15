/**
 * File content viewer migrated from the reference project's
 * content-viewer.tsx: routes by extension to text (numbered lines), CSV/TSV
 * (table), markdown (react-markdown), binary (open-externally placeholder),
 * and empty states. Rendering stays inside the detached panel / file tab.
 */
import ReactMarkdown from 'react-markdown'
import { IconFileText } from '../../../../shared/tabler-icons.tsx'
import type { Translate } from '../../../../shared/i18n.ts'
import type { WorkspaceMessage } from '../i18n.ts'
import { highlightCode, languageForPath } from './syntax-highlight.ts'

/** Highlight one source line (empty lines render as a single space). */
function highlightLine(line: string, language: string): string {
  return line === '' ? ' ' : highlightCode(line, language)
}type ContentKind = 'text' | 'csv' | 'markdown' | 'html' | 'image' | 'pdf' | 'binary'

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

/** Minimal RFC-ish CSV/TSV split (quoted fields, capped at 500 rows). */
export function parseDelimitedRows(text: string, delimiter: string): string[][] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const rows: string[][] = []
  for (const line of lines) {
    if (line === '') continue
    const cells: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]!
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"'
          i += 1
        } else {
          inQuotes = !inQuotes
        }
        continue
      }
      if (ch === delimiter && !inQuotes) {
        cells.push(current)
        current = ''
        continue
      }
      current += ch
    }
    cells.push(current)
    rows.push(cells)
    if (rows.length >= 500) break
  }
  return rows
}

export function ContentViewer({
  path,
  content,
  binary,
  size,
  data,
  onOpenExternal,
  t,
}: {
  path: string
  content: string | null
  binary: boolean
  size?: number
  /** Full base64 payload for binary previews (images / PDFs). */
  data?: string
  onOpenExternal?(): void
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const kind = detectKind(path, binary)
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path

  if (kind === 'image' && data !== undefined) {
    return (
      <div className="oh-dsh-content-media">
        <img
          src={`data:${mimeFor(path)};base64,${data}`}
          alt={name}
        />
      </div>
    )
  }

  if (kind === 'pdf' && data !== undefined) {
    return (
      <div className="oh-dsh-content-media">
        <iframe title={name} src={`data:application/pdf;base64,${data}`} />
      </div>
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
    return (
      <div className="oh-dsh-content-empty">
        <IconFileText size={20} />
        <strong>{name}</strong>
        <span>{t('files.viewer.binary')}</span>
        {onOpenExternal !== undefined && (
          <button type="button" onClick={onOpenExternal}>{t('files.open')}</button>
        )}
      </div>
    )
  }

  if (content === null) {
    return (
      <div className="oh-dsh-content-empty">
        <IconFileText size={20} />
        <strong>{name}</strong>
        <span>{t('overlay.no-content')}</span>
      </div>
    )
  }

  if (kind === 'markdown') {
    return (
      <div className="oh-dsh-content-markdown">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    )
  }

  if (kind === 'csv') {
    const delimiter = path.toLowerCase().endsWith('.tsv') ? '\t' : ','
    const rows = parseDelimitedRows(content, delimiter)
    const header = rows[0] ?? []
    const body = rows.slice(1)
    return (
      <div className="oh-dsh-content-root">
        <div className="oh-dsh-content-meta">
          <span>{delimiter === '\t' ? 'tsv' : 'csv'}</span>
          <span>{size === undefined ? '' : formatBytes(size)}</span>
        </div>
        <div className="oh-dsh-content-table-wrap">
          <table className="oh-dsh-content-table">
            {header.length > 0 && (
              <thead>
                <tr>
                  {header.map((cell, index) => <th key={`h-${index}`}>{cell}</th>)}
                </tr>
              </thead>
            )}
            <tbody>
              {body.map((row, rowIndex) => (
                <tr key={`r-${rowIndex}`}>
                  {row.map((cell, cellIndex) => <td key={`c-${rowIndex}-${cellIndex}`}>{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  const lines = content.split('\n')
  const language = languageForPath(path)
  return (
    <div className="oh-dsh-content-root">
      <div className="oh-dsh-content-meta">
        <span>{name}</span>
        <span>{language === '' ? `${lines.length} lines` : `${language} · ${lines.length} lines`}</span>
      </div>
      <ol className={`oh-dsh-content-lines${language === '' ? '' : ' is-highlighted'}`}>
        {lines.map((line, index) => (
          <li key={index}>
            <span className="oh-dsh-content-line-number">{index + 1}</span>
            {language === '' ? (
              <code>{line === '' ? ' ' : line}</code>
            ) : (
              // Per-line Prism output — escaped by the highlighter.
              <code dangerouslySetInnerHTML={{ __html: highlightLine(line, language) }} />
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

function formatBytes(size: number): string {
  if (size < 1024) return `${String(size)} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
