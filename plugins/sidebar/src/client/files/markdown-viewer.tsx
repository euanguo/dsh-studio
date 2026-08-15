/**
 * Markdown preview renderer for the DSH sidebar.
 *
 * Uses react-markdown + remark-gfm (GFM tables/strikethrough/task lists) and
 * reuses the existing Prism highlighter for code blocks. Interactive GFM task
 * checkboxes report their 0-based checkbox index; the caller maps that to a
 * source line through `findTaskMarkerSourceLines`.
 */
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { highlightCode } from './syntax-highlight.ts'
import { findTaskMarkerSourceLines } from './markdown-task-list.ts'

export interface MarkdownViewerProps {
  content: string
  /** When set, task checkboxes become interactive. `sourceLine` is 1-based. */
  onTaskToggle?(input: { sourceLine: number; checked: boolean }): void
  /** When false, all checkboxes render disabled. */
  taskTogglesEnabled?: boolean
}

export function MarkdownViewer({
  content,
  onTaskToggle,
  taskTogglesEnabled = true,
}: MarkdownViewerProps): JSX.Element {
  const sourceLines = onTaskToggle === undefined ? [] : findTaskMarkerSourceLines(content)
  let taskCursor = -1

  return (
    <div className="oh-dsh-content-markdown" data-testid="markdown-viewer">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ node, className, children, ...props }) {
            const inline = className === undefined && !String(children).includes('\n')
            if (inline) {
              return (
                <code className={className} {...props}>{children}</code>
              )
            }
            const language = /language-([\w-]+)/.exec(className ?? '')?.[1] ?? ''
            const text = String(children).replace(/\n$/, '')
            return (
              <pre className="oh-dsh-markdown-code-block">
                <code
                  className={className}
                  dangerouslySetInnerHTML={{ __html: highlightCode(text, language) }}
                />
              </pre>
            )
          },
          input({ type, checked, disabled: _disabled, node: _node, ...props }) {
            if (type !== 'checkbox') {
              return <input type={type} checked={checked} {...props} />
            }
            taskCursor += 1
            const taskIndex = taskCursor
            const interactive = taskTogglesEnabled
              && onTaskToggle !== undefined
              && taskIndex < sourceLines.length
            const sourceLine = interactive ? sourceLines[taskIndex]! : undefined
            return (
              <input
                type="checkbox"
                className="oh-dsh-markdown-task-checkbox"
                checked={checked}
                disabled={!interactive}
                {...(interactive && sourceLine !== undefined
                  ? {
                      onChange: () => {
                        onTaskToggle!({ sourceLine, checked: checked !== true })
                      },
                    }
                  : {})}
                {...props}
              />
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
