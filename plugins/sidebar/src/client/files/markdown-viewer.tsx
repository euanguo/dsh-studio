/**
 * Markdown preview renderer for the DSH sidebar.
 *
 * Uses react-markdown + remark-gfm (GFM tables/strikethrough/task lists) and
 * reuses the existing Prism highlighter for code blocks. Interactive GFM task
 * checkboxes report their 0-based checkbox index; the caller maps that to a
 * source line through `findTaskMarkerSourceLines`.
 */
import { useMemo } from 'react'
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
  const headings = useMemo(() => extractHeadings(content), [content])
  let taskCursor = -1

  return (
    <div className="oh-dsh-content-markdown" data-testid="markdown-viewer">
      {headings.length > 1 ? (
        <nav className="oh-dsh-markdown-toc" aria-label="Table of contents">
          {headings.map(heading => (
            <a key={heading.id} href={`#${heading.id}`} style={{ paddingLeft: `${(heading.level - 1) * 10}px` }}>
              {heading.text}
            </a>
          ))}
        </nav>
      ) : null}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1({ children, ...props }) {
            return <h1 id={slugify(String(children))} {...props}>{children}</h1>
          },
          h2({ children, ...props }) {
            return <h2 id={slugify(String(children))} {...props}>{children}</h2>
          },
          h3({ children, ...props }) {
            return <h3 id={slugify(String(children))} {...props}>{children}</h3>
          },
          h4({ children, ...props }) {
            return <h4 id={slugify(String(children))} {...props}>{children}</h4>
          },
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


function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
}

function extractHeadings(content: string): Array<{ id: string; text: string; level: number }> {
  const result: Array<{ id: string; text: string; level: number }> = []
  for (const line of content.split('\n')) {
    const match = /^(#{1,4})\s+(.+)$/.exec(line)
    if (match === null) continue
    const level = match[1]!.length
    const text = match[2]!.trim()
    result.push({ id: slugify(text), text, level })
  }
  return result
}
