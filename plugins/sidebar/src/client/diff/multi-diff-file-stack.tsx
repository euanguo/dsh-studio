/**
 * Multi-file diff stack: placeholders until an IntersectionObserver (or an
 * explicit click/focus) mounts the real diff block. Unmounted rows never
 * build DiffViewer / Pierre workers — Synara's `MultiDiffFileStack` policy.
 *
 * Mounted blocks recycle themselves: when a block scrolls beyond the keep
 * band it swaps its rendered diff for a same-height placeholder (holding
 * the outer scroll position) and re-mounts when the user scrolls back.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Translate } from '@dsh-studio/shared/i18n'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceMessage } from '../i18n.ts'
import { DiffViewer } from './diff-viewer.tsx'
import { useCommentRails } from '../comments/comment-rails.tsx'
import { useSelectionActionOverlay, commentAnchorOf } from '../selection/use-selection-action.tsx'
import type { SessionsService } from '../client-types.ts'
import { useDiffCommentsStore, commentPathMatches, type WorkbenchComment } from './diff-comments-store.ts'
import { commentsToDiffLineAnnotations } from './comment-annotations.ts'
import { CommentBubble } from './comment-bubble.tsx'
import { reviewFileToDiffDocument, type GitReviewFile } from './git-review-diff.ts'
import type { PierreDiffTheme } from './pierre-adapter.tsx'

const OBSERVER_ROOT_MARGIN = '320px 0px'
const KEEP_BAND_ROOT_MARGIN = '1600px 0px'

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
  cwd,
  sessions,
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
  /** Workspace cwd for comment anchoring (enables per-file rails). */
  cwd?: string
  /** Session roster for the selection action bar (per block). */
  sessions?: SessionsService
}): JSX.Element {
  return (
    <div className="dsh-studio-multi-diff-list" data-testid="multi-diff-list">
      {files.map(file => {
        const mounted = renderedKeys.has(file.path)
        if (mounted) {
          return (
            <MultiDiffFileBlock
              key={file.path}
              file={file}
              theme={theme}
              t={t}
              layout={layout}
              wordWrap={wordWrap}
              {...(cwd === undefined ? {} : { cwd })}
              {...(sessions === undefined ? {} : { sessions })}
              {...(onExpandContext === undefined ? {} : { onExpandContext })}
              {...(onCollapse === undefined ? {} : { onCollapse })}
            />
          )
        }
        return (
          <section
            key={file.path}
            className="dsh-studio-multi-diff-block"
            data-path={file.path}
            data-mounted="false"
          >
            <MultiDiffPlaceholder
              file={file}
              onRequestRender={onRequestRender}
            />
          </section>
        )
      })}
    </div>
  )
}

/**
 * One mounted diff block. The diff document is memoized per file so parent
 * re-renders (expand/collapse of sibling blocks, rail resizes) don't rebuild
 * the document and bust the memoized DiffViewer below. The block renders
 * its own section so it can swap between the rendered diff and a
 * same-height placeholder when scrolled far outside the viewport.
 */
function MultiDiffFileBlock({
  file,
  theme,
  t,
  layout,
  wordWrap,
  onExpandContext,
  onCollapse,
  cwd,
  sessions,
}: {
  file: GitReviewFile
  theme: PierreDiffTheme
  t: Translate<WorkspaceMessage>
  layout: 'unified' | 'split'
  wordWrap: boolean
  onExpandContext?(file: GitReviewFile): void
  onCollapse?(path: string): void
  cwd?: string
  sessions?: SessionsService
}): JSX.Element {
  const document = useMemo(() => reviewFileToDiffDocument(file), [file])
  // Reactive subscription to the store (surfaces subscribe, never copy).
  const allComments = useDiffCommentsStore(state => state.comments)
  const fileComments = useMemo(
    () => (cwd === undefined
      ? []
      : allComments.filter(comment => commentPathMatches(comment.path, file.path, cwd))),
    [allComments, cwd, file.path],
  )
  const lineAnnotations = useMemo(
    () => commentsToDiffLineAnnotations(fileComments),
    [fileComments],
  )
  const rails = cwd === undefined ? null : useCommentRails({
    path: file.path,
    cwd,
    comments: fileComments,
    t,
    layer: typeof window === 'undefined' ? null : window.document.body,
    onAdd: input => {
      useDiffCommentsStore.getState().addComment({ ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() })
    },
    onResolve: id => { useDiffCommentsStore.getState().resolveComment(id) },
    onUnresolve: id => { useDiffCommentsStore.getState().unresolveComment(id) },
  })
  const sectionRef = useRef<HTMLElement | null>(null)
  const selectionAction = useSelectionActionOverlay({
    containerRef: sectionRef,
    path: file.path,
    cwd,
    layer: typeof window === 'undefined' ? null : window.document.body,
    sessions: sessions ?? null,
    ...(rails === null ? {} : { onComment: anchor => rails.composeAt(commentAnchorOf(anchor)) }),
    t,
  })
  const latestHeightRef = useRef<number | null>(null)
  const [releasedHeight, setReleasedHeight] = useState<number | null>(null)

  // Track the rendered height while the diff body is visible.
  useEffect(() => {
    if (releasedHeight !== null) return
    const node = sectionRef.current
    if (node === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => {
      const height = entries[0]?.contentRect.height
      if (height !== undefined && height > 0) latestHeightRef.current = height
    })
    observer.observe(node)
    return () => { observer.disconnect() }
  }, [releasedHeight])

  // Release the diff body when the block leaves the keep band; re-mount
  // (drop the height placeholder) when the user scrolls back in.
  useEffect(() => {
    const node = sectionRef.current
    if (node === null || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      const visible = entries.some(entry => entry.isIntersecting)
      if (!visible && releasedHeight === null) {
        const height = latestHeightRef.current
        if (height !== null) setReleasedHeight(height)
      } else if (visible && releasedHeight !== null) {
        setReleasedHeight(null)
      }
    }, {
      root: null,
      rootMargin: releasedHeight === null ? KEEP_BAND_ROOT_MARGIN : OBSERVER_ROOT_MARGIN,
      threshold: 0,
    })
    observer.observe(node)
    return () => { observer.disconnect() }
  }, [releasedHeight])

  return (
    <section
      ref={sectionRef}
      className="dsh-studio-multi-diff-block"
      data-path={file.path}
      data-mounted="true"
      data-doc-key={`${file.additions}:${file.deletions}:${file.lines.length}`}
    >
      {releasedHeight === null ? (
        <div className="dsh-studio-multi-diff-mounted">
          <div className="dsh-studio-multi-diff-file-header">
            <span title={file.path}>{file.path}</span>
            <small>
              <b>+{file.additions}</b> −{file.deletions}
            </small>
            <span className="dsh-studio-multi-diff-actions">
              {onExpandContext !== undefined ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { onExpandContext(file) }}
                >
                  {t('diff.expand-context-file')}
                </Button>
              ) : null}
              {onCollapse !== undefined ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { onCollapse(file.path) }}
                >
                  {t('source-control.view-all')}
                </Button>
              ) : null}
            </span>
          </div>
          <div className="dsh-studio-multi-diff-lines">
            {/*
              Pierre rendering with natural per-file sizing: the outer list
              scrolls the whole stack. Previously deadlocked because buildPatch
              emitted no @@ headers for review-style documents, so Pierre
              parsed 0 hunks and rendered nothing — fixed in file-diff.ts.
            */}
            {rails?.overlay()}
            {selectionAction.overlay}
            <DiffViewer
              document={document}
              theme={theme}
              t={t}
              virtualize={false}
              layout={layout}
              wordWrap={wordWrap}
              hideMeta
              cacheBust={`multi:${file.path}`}
              {...(fileComments.length > 0
                ? { lineAnnotations, renderAnnotation: annotation => <CommentBubble comment={annotation.metadata} /> }
                : {})}
              {...(rails === null ? {} : {
                onLineEnter: rails.onLineEnter,
                onLineLeave: rails.onLineLeave,
                renderGutterUtility: rails.gutterUtility,
              })}
            />
          </div>
        </div>
      ) : (
        <div
          className="dsh-studio-multi-diff-released"
          style={{ height: releasedHeight }}
          aria-hidden="true"
        />
      )}
    </section>
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
      className="dsh-studio-multi-diff-placeholder"
      data-testid="multi-diff-file-placeholder"
      data-path={path}
      onClick={() => { onRequestRender(path) }}
      onFocus={() => { onRequestRender(path) }}
      onMouseEnter={() => { onRequestRender(path) }}
    >
      <span className="dsh-studio-multi-diff-placeholder-name">{path}</span>
      <span className="dsh-studio-multi-diff-placeholder-stats">
        {file.additions > 0 ? <b>+{file.additions}</b> : null}
        {file.deletions > 0 ? <b>−{file.deletions}</b> : null}
      </span>
    </button>
  )
}
