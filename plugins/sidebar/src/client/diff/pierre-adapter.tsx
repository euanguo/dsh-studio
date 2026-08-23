/**
 * Pierre diff adapter (ported from the reference project's
 * `adapters/pierre-diff-adapter.tsx` + `pierre-diff-worker-pool.tsx`).
 *
 * Rendering is delegated to `@pierre/diffs/react` (line rows, syntax
 * highlight, virtualization); the worker pool keeps highlighting off the
 * main thread. `renderPierreDiff` returns null when the patch cannot be
 * parsed — the DiffViewer falls back to its structured RawDiff renderer.
 */
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { useEffect } from 'react'
import {
  FileDiff,
  Virtualizer,
  WorkerPoolContextProvider,
  useWorkerPool,
} from '@pierre/diffs/react'
import { parsePatchFiles } from '@pierre/diffs'
import type { AnnotationSide, DiffLineAnnotation } from '@pierre/diffs'
import type { DiffLayoutStyle } from './file-diff.ts'
import type { WorkbenchComment } from './diff-comments-store.ts'

/** Light/dark theme names Pierre understands. */
export type PierreDiffTheme = 'github-light' | 'github-dark'

/**
 * Resolve the current theme from the DSH theme attribute, falling back to
 * the pane's actual background luminance when the attribute is absent (a
 * dark-rendered panes can sit under a nominal light skin). The edited
 * canvas must read like the pane it lives in.
 */
export function resolvePierreDiffTheme(): PierreDiffTheme {
  if (typeof document === 'undefined') return 'github-light'
  if (document.body?.dataset.dsDarkTheme !== undefined) return 'github-dark'
  const bg = getComputedStyle(document.body).backgroundColor
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(bg)
  if (m !== null) {
    const luminance = (0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3])) / 255
    if (luminance < 0.5) return 'github-dark'
  }
  return 'github-light'
}

/**
 * Worker factory for the pierre pool.
 *
 * The client bundle is emitted in cjs module-factory format, where
 * `import.meta.url` is empty — so `new URL(..., import.meta.url)` cannot
 * resolve the worker. The worker is therefore built as its own ESM chunk
 * (`client-pierre-worker.js`, see build-config.mjs + pierre-worker-entry.ts)
 * and served by the capabilities /capabilities/bundle route (same origin).
 */
const PIERRE_WORKER_URL = '/capabilities/bundle/pierre-worker.js'

export function createPierreDiffWorker(): Worker {
  return new Worker(
    PIERRE_WORKER_URL,
    { type: 'module' },
  )
}

const POOL_SIZE = 2

export function DiffWorkerPoolProvider({ children }: { readonly children?: ReactNode }): JSX.Element {
  return (
    <WorkerPoolContextProvider
      poolOptions={{
        workerFactory: createPierreDiffWorker,
        poolSize: POOL_SIZE,
        totalASTLRUCacheSize: 240,
      }}
      highlighterOptions={{ tokenizeMaxLineLength: 1000 }}
    >
      {children}
    </WorkerPoolContextProvider>
  )
}

/** Keep the pool theme in sync with the app theme. */
function DiffWorkerThemeSync({ theme }: { readonly theme: PierreDiffTheme }): null {
  const workerPool = useWorkerPool()
  useEffect(() => {
    if (workerPool === undefined) return
    const current = workerPool.getDiffRenderOptions()
    if (current.theme === theme) return
    void workerPool.setRenderOptions({ ...current, theme }).catch((cause: unknown) => {
      // Highlighting continues on the previous theme; log and keep going.
      console.warn('[sidebar] failed to update pierre theme', cause)
    })
  }, [theme, workerPool])
  return null
}

export function renderPierreDiff(
  input: Readonly<{
    patch: string
    cacheKey: string
    theme: PierreDiffTheme
    surfaceClassName: string
    layout?: DiffLayoutStyle
    wordWrap?: boolean
    /** Single-file center surfaces: Virtualizer owns scroll.
     *  Multi-diff stacked panes: false so content grows and the outer list scrolls. */
    virtualize?: boolean
    /** Line comments rendered as annotation rows on the new-side lines. */
    lineAnnotations?: DiffLineAnnotation<WorkbenchComment>[]
    renderAnnotation?: (annotation: DiffLineAnnotation<WorkbenchComment>) => ReactNode
    /** Clicking a line-number gutter reports the line (prefills the comment form). */
    onLineNumberClick?: (input: { lineNumber: number; side: AnnotationSide }) => void
    /** Hover-comment rails: gutter "+" + hover tracking (see comment-rails). */
    onLineEnter?: (props: { lineNumber: number; lineElement: HTMLElement }) => void
    onLineLeave?: () => void
    renderGutterUtility?: (getHoveredLine?: () => { lineNumber: number } | undefined) => ReactNode
  }>,
): ReactNode {
  const parsed = parsePatchFiles(input.patch, input.cacheKey)
  const fileDiff = parsed[0]?.files[0]
  if (fileDiff === undefined) return null

  const layout = input.layout ?? 'unified'
  const wordWrap = input.wordWrap === true
  const virtualize = input.virtualize !== false
  const hasAnnotations = input.lineAnnotations !== undefined && input.lineAnnotations.length > 0

  const file = (
    <FileDiff
      fileDiff={fileDiff}
      options={{
        disableFileHeader: true,
        diffStyle: layout,
        lineDiffType: 'none',
        overflow: wordWrap ? 'wrap' : 'scroll',
        theme: input.theme,
        ...(input.onLineNumberClick === undefined
          ? {}
          : {
              onLineNumberClick: props => {
                input.onLineNumberClick?.({ lineNumber: props.lineNumber, side: props.annotationSide })
              },
            }),
        ...(input.onLineEnter === undefined ? {} : { onLineEnter: input.onLineEnter }),
        ...(input.onLineLeave === undefined ? {} : { onLineLeave: input.onLineLeave }),
      }}
      {...(input.renderGutterUtility === undefined ? {} : { renderGutterUtility: input.renderGutterUtility })}
      {...(hasAnnotations
        ? {
            lineAnnotations: input.lineAnnotations,
            ...(input.renderAnnotation === undefined ? {} : { renderAnnotation: input.renderAnnotation }),
          }
        : {})}
    />
  )

  if (!virtualize) {
    return <div className={input.surfaceClassName}>{file}</div>
  }

  return (
    <Virtualizer className={input.surfaceClassName} config={{ overscrollSize: 300 }}>
      {file}
    </Virtualizer>
  )
}

/** Convenience hook: current pierre theme + re-render on theme change. */
export function usePierreDiffTheme(): PierreDiffTheme {
  const [theme, setTheme] = useState<PierreDiffTheme>(() => resolvePierreDiffTheme())
  useEffect(() => {
    const apply = (): void => setTheme(resolvePierreDiffTheme())
    apply()
    const observer = new MutationObserver(apply)
    if (document.body !== null) {
      observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    }
    return () => { observer.disconnect() }
  }, [])
  return useMemo(() => theme, [theme])
}

export function DiffThemeSync(): JSX.Element {
  const theme = usePierreDiffTheme()
  return <DiffWorkerThemeSync theme={theme} />
}
