/**
 * Built-in file viewers of the desktop sidebar (text / binary / sandboxed
 * HTML). Extracted from plugin.tsx.
 */
import type { Translate } from '../../../../shared/i18n.ts'
import type { WorkspaceMessage } from '../i18n.ts'
import { EmptyView } from '../kit/status.tsx'

export function TextFileViewer({
  content,
  path,
  title,
}: {
  content: string
  path: string
  title: string
}): JSX.Element {
  return (
    <div className="oh-dsh-file-preview">
      <div><strong title={path}>{title}</strong></div>
      <pre>{content}</pre>
    </div>
  )
}

export function BinaryFileViewer({
  onOpen,
  path,
  title,
  t,
}: {
  onOpen(): Promise<void>
  path: string
  title: string
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  return (
    <div className="oh-dsh-file-preview">
      <div>
        <strong title={path}>{title}</strong>
        <button type="button" onClick={() => { void onOpen() }}>
          {t('files.open')}
        </button>
      </div>
      <EmptyView title={t('files.viewer.binary')} />
    </div>
  )
}

export function HtmlFileViewer({
  content,
  path,
  title,
}: {
  content: string
  path: string
  title: string
}): JSX.Element {
  return (
    <div className="oh-dsh-file-preview oh-dsh-html-preview">
      <div><strong title={path}>{title}</strong></div>
      <iframe title={title} sandbox="" srcDoc={content} />
    </div>
  )
}
