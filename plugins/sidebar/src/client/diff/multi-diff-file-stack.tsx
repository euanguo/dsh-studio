/**
 * Multi-file diff stack: placeholders until an IntersectionObserver (or an
 * explicit click/focus) mounts the real diff block. Unmounted rows never
 * build DiffViewer / Pierre workers — Synara's `MultiDiffFileStack` policy.
 */
import { useEffect, useRef } from 'react'
import type { Translate } from '../../../../shared/i18n.ts'
import type { WorkspaceMessage } from '../i18n.ts'
import type { GitReviewFile } from '../review/review-types.ts'
import { DiffViewer } from './diff-viewer.tsx'
import { reviewFileToDiffDocument } from '../review/review-diff.ts'
import type { PierreDiffTheme } from './pierre-adapter.tsx'

const OBSERVER_ROOT_MARGIN = '320px 0px'

export function MultiDiffFileStack({
  files,
  renderedKeys,
  onRequestRender,
  onCollapse,
  theme,
  t,
  wordWrap = false,
  layout = 'unified',
  onExpandContext,
}: {
  files: readonly GitReviewFile[]
  renderedKeys: ReadonlySet<string>
  onRequestRender(path: string): void
  onCollapse?(path: string): void
  theme: PierreDiffTheme
  t: Translate<WorkspaceMessage>
  wordWrap?: boolean
  layout?: 'unified' | 'split'
  onExpandContext?(file: GitReviewFile): void
}): JSX.Element {
  return (
    <div className="oh-dsh-multi-diff-list" data-testid="multi-diff-list">
      {files.map(file => {
        const mounted = renderedKeys.has(file.path)
        return (
          <section
            key={file.path}
            className="oh-dsh-multi-diff-block"
            data-path={file.path}
            data-mounted={mounted ? 'true' : 'false'}
          >
            {mounted ? (
              <div className="oh-dsh-multi-diff-mounted">
                <div className="oh-dsh-multi-diff-file-header">
                  <span title={file.path}>{file.path}</span>
                  <small>
                    <b>+{file.additions}</b> −{file.deletions}
                  </small>
                  <span className="oh-dsh-multi-diff-actions">
                    {onExpandContext !== undefined ? (
                      <button type="button" onClick={() => { onExpandContext(file) }}>
                        Expand context
                      </button>
                    ) : null}
                    {onCollapse !== undefined ? (
                      <button type="button" onClick={() => { onCollapse(file.path) }}>
                        {t('source-control.view-all')}
                      </button>
                    ) : null}
                  </span>
                </div>
                <div className="oh-dsh-multi-diff-lines">
                  {/*
                    rawOnly is kept deliberately: a natural-height FileDiff
                    container measures 0×0 and the render loop deadlocks
                    (no rows). Switching this stack to Pierre requires either
                    a bounded-height Virtualizer per file or the official
                    MultiFileDiff component (see viewer-libraries-research §4).
                  */}
                  <DiffViewer
                    document={reviewFileToDiffDocument(file)}
                    theme={theme}
                    rawOnly
                    layout={layout}
                    wordWrap={wordWrap}
                    hideMeta
                    cacheBust={`multi:${file.path}`}
                  />
                </div>
              </div>
            ) : (
              <MultiDiffPlaceholder
                file={file}
                onRequestRender={onRequestRender}
              />
            )}
          </section>
        )
      })}
    </div>
  )
}

function MultiDiffPlaceholder({
  file,
  onRequestRender,
}: {
  file: GitReviewFile
  onRequestRender(path: string): void
}): JSX.Element {
  const rowRef = useRef<HTMLButtonElement | null>(null)
  const path = file.path

  useEffect(() => {
    const node = rowRef.current
    if (node === null) return
    if (typeof IntersectionObserver === 'undefined') {
      onRequestRender(path)
      return
    }
    const observer = new IntersectionObserver(
      entries => {
        if (!entries.some(entry => entry.isIntersecting)) return
        onRequestRender(path)
        observer.disconnect()
      },
      { root: null, rootMargin: OBSERVER_ROOT_MARGIN, threshold: 0.01 },
    )
    observer.observe(node)
    return () => { observer.disconnect() }
  }, [onRequestRender, path])

  return (
    <button
      type="button"
      ref={rowRef}
      className="oh-dsh-multi-diff-placeholder"
      data-testid="multi-diff-file-placeholder"
      data-path={path}
      onClick={() => { onRequestRender(path) }}
      onFocus={() => { onRequestRender(path) }}
      onMouseEnter={() => { onRequestRender(path) }}
    >
      <span className="oh-dsh-multi-diff-placeholder-name">{path}</span>
      <span className="oh-dsh-multi-diff-placeholder-stats">
        {file.additions > 0 ? <b>+{file.additions}</b> : null}
        {file.deletions > 0 ? <b>−{file.deletions}</b> : null}
      </span>
    </button>
  )
}
