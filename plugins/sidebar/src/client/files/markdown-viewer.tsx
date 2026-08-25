/**
 * Markdown preview renderer for the DSH sidebar.
 *
 * Uses react-markdown + remark-gfm (GFM tables/strikethrough/task lists) and
 * Shiki (`@pierre/diffs`' codeToHtml re-export) for fenced code blocks —
 * same grammar/theme family as the File/Diff surfaces. Interactive GFM task
 * checkboxes report their 0-based checkbox index; the caller maps that to a
 * source line through `findTaskMarkerSourceLines`.
 */
import { SidebarSurfaceCss as surfaceCss } from '../styles.js'
import { useEffect, useMemo, useState, type Ref } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { codeToHtml } from '@pierre/diffs'
import { usePierreDiffTheme } from '../diff/pierre-adapter.tsx'
import { findTaskMarkerSourceLines } from './markdown-task-list.ts'
import { ScrollArea } from '@dsh-studio/shared/ui'
import type { Translate } from '@dsh-studio/shared/i18n'
import type { WorkspaceMessage } from '../i18n.ts'

export interface MarkdownViewerProps {
  content: string
  /** When set, task checkboxes become interactive. `sourceLine` is 1-based. */
  onTaskToggle?(input: { sourceLine: number; checked: boolean }): void
  /** When false, all checkboxes render disabled. */
  taskTogglesEnabled?: boolean
  /** Forwarded to the scroll host (the selection-insert popup host). */
  containerRef?: Ref<HTMLDivElement>
  t: Translate<WorkspaceMessage>
}

export function MarkdownViewer({
  content,
  onTaskToggle,
  taskTogglesEnabled = true,
  containerRef,
  t,
}: MarkdownViewerProps): JSX.Element {
  const sourceLines = onTaskToggle === undefined ? [] : findTaskMarkerSourceLines(content)
  const headings = useMemo(() => extractHeadings(content), [content])
  let taskCursor = -1

  return (
    <ScrollArea ref={containerRef} className={surfaceCss["dsh-studio-content-markdown"]} viewportClassName="dsh-studio-ui-scroll-viewport-inset" data-testid="markdown-viewer">
      {headings.length > 1 ? (
        <nav className={surfaceCss["dsh-studio-markdown-toc"]} aria-label={t('files.table-of-contents')}>
          {headings.map(heading => (
            <a key={heading.id} href={`#${heading.id}`} style={{ paddingLeft: `${(heading.level - 1) * 10}px` }}>
              {heading.text}
            </a>
          ))}
        </nav>
      ) : null}
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
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
            // Inline code only — fenced blocks are handled by the `pre` override.
            return (
              <code className={className} {...props}>{children}</code>
            )
          },
          pre({ node: _node, children, ...props }) {
            // react-markdown wraps fenced code in <pre><code class="language-x">;
            // replace that wrapper with the Shiki block so we don't end up
            // with a nested pre > div > pre.shiki structure.
            const codeEl = children as {
              props?: { className?: string; children?: unknown }
            } | undefined
            const className = codeEl?.props?.className
            if (typeof className !== 'string' || !className.startsWith('language-')) {
              return <pre {...props}>{children}</pre>
            }
            const language = /^language-([\w-]+)/.exec(className)?.[1] ?? 'text'
            const text = String(codeEl?.props?.children ?? '').replace(/\n$/, '')
            return <MarkdownCodeBlock text={text} language={language} />
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
                className={surfaceCss["dsh-studio-markdown-task-checkbox"]}
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
    </ScrollArea>  
  )
}


/** Fenced code block highlighted via Shiki (codeToHtml); plain text until ready. */
function MarkdownCodeBlock({
  text,
  language,
}: {
  text: string
  language: string
}): JSX.Element {
  const pierreTheme = usePierreDiffTheme()
  const theme = pierreTheme === 'github-dark' ? 'github-dark' : 'github-light'
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setHtml(null)
    codeToHtml(text, { lang: language, theme })
      .then(output => { if (alive) setHtml(output) })
      .catch(() => { if (alive) setHtml(escapeHtml(text)) })
    return () => { alive = false }
  }, [language, text, theme])

  if (html === null) {
    return (
      <pre className={`dsh-studio-markdown-code-block`}>
        <code>{text}</code>
      </pre>
    )
  }
  // Shiki emits its own <pre class="shiki">; the wrapper keeps the block
  // styling consistent with the pre-highlight placeholder.
  return (
    <div
      className={`dsh-studio-markdown-code-block ${surfaceCss["dsh-studio-markdown-code-shiki"]}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
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
