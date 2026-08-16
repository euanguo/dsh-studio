/**
 * Center surface renderers for the desktop sidebar: diff / commit /
 * conflict / browser views (the file surface lives in file-surface.tsx).
 * Registered into `centerSurfaceRendererRegistry` by the plugin assembly.
 * Each renderer is a pure view over its surface identity — data comes from
 * the runtimes / sidebar API.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Translate } from '../../../../shared/i18n.ts'
import { toast } from '../../../../shared/toast.tsx'
import type { WorkspaceMessage } from '../i18n.ts'
import { betterSidebarApi } from '../better-sidebar-api.ts'
import type { FileContents, MergeConflictResolution } from '@pierre/diffs'
import { UnresolvedFile, Virtualizer } from '@pierre/diffs/react'
import {
  getDiffRuntime,
  getFileRuntime,
  getSourceControlRuntime,
  sidebarScopeKey,
} from '../runtimes/registry.ts'
import { useSidebarChromeStore } from '../runtimes/chrome-store.ts'
import {
  committedDocKey,
  committedListKey,
  commitDocKey,
  commitListKey,
  worktreeDocKey,
  worktreeListKey,
} from '../runtimes/diff-runtime.ts'
import { basename, resolveSidebarPath } from '../../../../shared/path.ts'
import { useCenterSurfaceStore } from './center-surface-store.ts'
import { binding, registerKeymapAction } from '../kit/keymap.ts'
import { EmptyView, ErrorView, LoadingView } from '../kit/status.tsx'
import { DiffViewer } from '../diff/diff-viewer.tsx'
import { DiffToolbar } from '../diff/diff-toolbar.tsx'
import { useDiffViewPreferences } from '../diff/diff-view-preferences.ts'
import { DiffPathTreeNav, type DiffPathTreeRow } from '../diff/path-tree-nav.tsx'
import { buildDiffTreeRows } from '../diff/diff-path-tree.ts'
import { MultiDiffFileStack } from '../diff/multi-diff-file-stack.tsx'
import { ImageDiffViewer } from '../diff/image-diff-viewer.tsx'
import { nextDiffCommentId, useDiffCommentsStore, commentPathMatches, type DiffComment } from '../diff/diff-comments-store.ts'
import { commentsToDiffLineAnnotations } from '../diff/comment-annotations.ts'
import { CommentBubble } from '../diff/comment-bubble.tsx'
import { resolveConflictRegionContents } from '../diff/merge-conflict-resolve.ts'
import { buildDiffDocument } from '../diff/file-diff.ts'
import { usePierreDiffTheme, type PierreDiffTheme } from '../diff/pierre-adapter.tsx'
import { parseGitReviewDiff, reviewFileToDiffDocument, type GitReviewFile } from '../diff/git-review-diff.ts'
import type {
  CommitCenterSurface,
  CommitFileCenterSurface,
  CommittedCenterSurface,
  ConflictCenterSurface,
  DiffAllCenterSurface,
  DiffCenterSurface,
} from './types.ts'

/** Single-file diff render caps (fall back to the too-large notice). */
const DIFF_MAX_RENDER_LINES = 120_000
const DIFF_MAX_RENDER_CHARS = 6_000_000
/** "Expand context" bounds: start, step, ceiling (lines). */
const DIFF_CONTEXT_INITIAL = 3
const DIFF_CONTEXT_LIMIT = 200
const DIFF_CONTEXT_STEP = 20
/** Files pre-mounted in a diff-all stack (the rest mount on scroll). */
const DIFF_ALL_PREMOUNT_COUNT = 6

/* ---------- diff ---------- */

export function DiffSurfaceView({
  surface,
  t,
}: {
  surface: DiffCenterSurface
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const [context, setContext] = useState(DIFF_CONTEXT_INITIAL)
  const [expanding, setExpanding] = useState(false)
  const [imageDiff, setImageDiff] = useState<{ oldData: string; newData: string } | null>(null)
  const [commentLine, setCommentLine] = useState('')
  const [commentBody, setCommentBody] = useState('')
  // Cooldown after "Expand context" (the button re-enables when it fires).
  const expandTimerRef = useRef<number | null>(null)
  useEffect(() => () => {
    if (expandTimerRef.current !== null) window.clearTimeout(expandTimerRef.current)
  }, [])
  const isImagePath = /\.(png|jpe?g|gif|webp|bmp|ico|svg|avif)$/i.test(surface.filePath)
  const theme = usePierreDiffTheme()
  const layout = useDiffViewPreferences(state => state.layout)
  const wordWrap = useDiffViewPreferences(state => state.wordWrap)

  // The diff document lives in the retained diff runtime (M1): re-opening
  // this tab renders instantly from the cached entry.
  const runtime = useMemo(
    () => getDiffRuntime({ sessionId: surface.sessionId, cwd: surface.cwd }),
    [surface.cwd, surface.sessionId],
  )
  useSyncExternalStore(runtime.subscribe, runtime.fingerprint)
  const docKey = worktreeDocKey(surface.staged, surface.filePath, context)
  const doc = runtime.getDoc(docKey)
  useEffect(() => {
    if (runtime.getDoc(docKey) === undefined) {
      void runtime.ensureWorktreeDoc(surface.staged, surface.filePath, context)
    }
  }, [runtime, docKey, surface.staged, surface.filePath, context])
  const diff = doc !== undefined && doc.phase === 'ready' ? doc.diff : null

  // Persisted comments render as Pierre annotation rows on the new-side
  // lines; the store is the single live source (M5 — no local mirror).
  const allComments = useDiffCommentsStore(state => state.comments)
  const comments = useMemo(
    () => allComments.filter(comment =>
      commentPathMatches(comment.filePath, surface.filePath, surface.cwd)
      && comment.createdAt.length > 0,
    ),
    [allComments, surface.cwd, surface.filePath],
  )
  const lineAnnotations = useMemo(
    () => commentsToDiffLineAnnotations(comments),
    [comments],
  )
  const renderCommentAnnotation = useCallback((annotation: { metadata?: DiffComment }) => (
    annotation.metadata !== undefined
      ? <CommentBubble comment={annotation.metadata} />
      : null
  ), [])
  const onLineNumberClick = useCallback((input: { lineNumber: number; side: 'additions' | 'deletions' }) => {
    // Comments attach to the new side only; ignore old-side gutter clicks.
    if (input.side !== 'additions') return
    setCommentLine(String(input.lineNumber))
  }, [])

  const document = useMemo(
    () => (diff === null ? null : buildDiffDocument({
      path: surface.filePath,
      change: 'modified',
      additions: 0,
      deletions: 0,
      patch: diff,
    })),
    [diff, surface.filePath],
  )
  useEffect(() => {
    if (diff === null || !isImagePath || !(diff.includes('Binary files ') && diff.includes(' differ'))) {
      setImageDiff(null)
      return
    }
    let alive = true
    setImageDiff(null)
    void betterSidebarApi.gitImageDiff(
      { sessionId: surface.sessionId, cwd: surface.cwd },
      surface.filePath,
      surface.staged,
    ).then(result => {
      if (alive) setImageDiff(result)
    }).catch(() => {
      if (alive) setImageDiff(null)
    })
    return () => { alive = false }
  }, [diff, isImagePath, surface.cwd, surface.filePath, surface.sessionId, surface.staged])
  if (doc !== undefined && doc.phase === 'error') {
    return <ErrorView message={doc.message ?? t('overlay.no-content')} />
  }
  if (doc === undefined || doc.phase === 'loading' || diff === null || document === null) {
    return <LoadingView label={t('overlay.loading')} />
  }
  if (diff.trim() === '') {
    return <ErrorView message={t('workspace.no-text-diff')} />
  }
  if (diff.includes('Binary files ') && diff.includes(' differ')) {
    return (
      <div className="oh-dsh-diff-surface">
        <DiffToolbar t={t} />
        {imageDiff !== null ? (
          <div className="oh-dsh-diff-surface-body">
            <ImageDiffViewer
              oldData={imageDiff.oldData}
              newData={imageDiff.newData}
              oldLabel={`Original · ${surface.filePath}`}
              newLabel={`Modified · ${surface.filePath}`}
            />
          </div>
        ) : (
          <LoadingView label={t('workspace.loading-diff')} />
        )}
      </div>
    )
  }
  if (document.lines.length > DIFF_MAX_RENDER_LINES || diff.length > DIFF_MAX_RENDER_CHARS) {
    return (
      <div className="oh-dsh-diff-surface">
        <DiffToolbar t={t} />
        <EmptyView title={t('diff.too-large', { lines: document.lines.length })} />
      </div>
    )
  }
  return (
    <div className="oh-dsh-diff-surface">
      <DiffToolbar
        leading={(
          <span className="oh-dsh-diff-toolbar-title">
            <span title={surface.filePath}>{surface.filePath}</span>
            <small>{surface.staged ? t('source-control.section.staged') : t('source-control.section.unstaged')}</small>
          </span>
        )}
        t={t}
      />
      <div className="oh-dsh-diff-surface-body">
        <DiffViewer
          document={document}
          theme={theme}
          t={t}
          layout={layout}
          wordWrap={wordWrap}
          hideMeta
          cacheBust={`${surface.staged ? 'staged' : 'unstaged'}:${context}`}
          {...(lineAnnotations.length > 0
            ? { lineAnnotations, renderAnnotation: renderCommentAnnotation }
            : {})}
          onLineNumberClick={onLineNumberClick}
        />
      </div>
      <div className="oh-dsh-diff-context-bar">
        <button
          type="button"
          disabled={expanding || context >= DIFF_CONTEXT_LIMIT}
          onClick={() => {
            setExpanding(true)
            setContext(value => Math.min(DIFF_CONTEXT_LIMIT, value + DIFF_CONTEXT_STEP))
            if (expandTimerRef.current !== null) window.clearTimeout(expandTimerRef.current)
            expandTimerRef.current = window.setTimeout(() => setExpanding(false), 1200)
          }}
        >
          {expanding ? t('workspace.loading-diff') : t('diff.expand-context', { current: context, next: Math.min(DIFF_CONTEXT_LIMIT, context + DIFF_CONTEXT_STEP) })}
        </button>
      </div>
      <div className="oh-dsh-diff-comments">
        {comments.length > 0 ? (
          <div className="oh-dsh-diff-comments-list">
            {comments.map(comment => (
              <div key={comment.id} className="oh-dsh-diff-comment">
                <span className="oh-dsh-diff-comment-line">Line {comment.line}</span>
                <span className="oh-dsh-diff-comment-body">{comment.body}</span>
                <button
                  type="button"
                  onClick={() => {
                    useDiffCommentsStore.getState().removeComment(comment.id)
                  }}
                >✕</button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="oh-dsh-diff-comment-form">
          <input
            type="number"
            min={1}
            aria-label={t('workspace.comment-line')}
            placeholder={t('workspace.comment-line')}
            value={commentLine}
            onChange={event => { setCommentLine(event.target.value) }}
          />
          <input
            type="text"
            aria-label={t('workspace.comment-placeholder')}
            placeholder={t('workspace.comment-placeholder')}
            value={commentBody}
            onChange={event => { setCommentBody(event.target.value) }}
          />
          <button
            type="button"
            disabled={commentLine === '' || commentBody.trim() === ''}
            onClick={() => {
              const line = Number(commentLine)
              if (!Number.isInteger(line) || line < 1) return
              const comment: DiffComment = {
                id: nextDiffCommentId(),
                filePath: surface.filePath,
                line,
                body: commentBody.trim(),
                createdAt: new Date().toISOString(),
              }
              useDiffCommentsStore.getState().addComment(comment)
              setCommentLine('')
              setCommentBody('')
            }}
          >{t('workspace.add-comment')}</button>
        </div>
      </div>
    </div>
  )
}

/* ---------- diff-all (section "view all") ---------- */

export function DiffAllSurfaceView({
  surface,
  t,
}: {
  surface: DiffAllCenterSurface
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const [renderedKeys, setRenderedKeys] = useState<ReadonlySet<string>>(new Set())
  const [expanding, setExpanding] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)
  // F7 navigation cache: block element → its change-row list + doc key.
  const rowsCacheRef = useRef(new WeakMap<Element, { key: string; rows: Element[] }>())
  const theme = usePierreDiffTheme()
  const layout = useDiffViewPreferences(state => state.layout)
  const wordWrap = useDiffViewPreferences(state => state.wordWrap)

  // The change list lives in the retained diff runtime (M1); selection and
  // collapsed directories are chrome (shared with the source-control panel).
  const runtime = useMemo(
    () => getDiffRuntime({ sessionId: surface.sessionId, cwd: surface.cwd }),
    [surface.cwd, surface.sessionId],
  )
  useSyncExternalStore(runtime.subscribe, runtime.fingerprint)
  const listKey = worktreeListKey(surface.staged)
  const list = runtime.getList(listKey)
  const files = list !== undefined && list.phase === 'ready' ? list.files : null
  useEffect(() => {
    if (runtime.getList(listKey) === undefined) {
      void runtime.ensureWorktreeList(surface.staged)
    }
  }, [runtime, listKey, surface.staged])
  const scopeKey = sidebarScopeKey({ sessionId: surface.sessionId, cwd: surface.cwd })
  const chrome = useSidebarChromeStore(state => state.getSlice(scopeKey))
  const selectedPath = chrome.sourceControl.selectedPath
  const collapsedDirs = useMemo(
    () => new Set(chrome.sourceControl.collapsedDirectories),
    [chrome.sourceControl.collapsedDirectories],
  )

  // Pre-mount the first files once per surface mount — the retained runtime
  // may already hold a ready list when the tab reopens.
  const previousFilesRef = useRef<readonly GitReviewFile[] | null>(null)
  useEffect(() => {
    if (files === null) return
    if (previousFilesRef.current !== null) {
      previousFilesRef.current = files
      return
    }
    previousFilesRef.current = files
    setRenderedKeys(new Set(files.slice(0, DIFF_ALL_PREMOUNT_COUNT).map(file => file.path)))
  }, [files])

  const requestRender = useCallback((path: string) => {
    setRenderedKeys(previous => {
      if (previous.has(path)) return previous
      const next = new Set(previous)
      next.add(path)
      return next
    })
  }, [])

  const navigateChange = useCallback((direction: 1 | -1) => {
    const root = listRef.current
    if (root === null) return
    // Pierre rows live in each block's diffs-container shadow root. The row
    // ELEMENT lists are cached per block keyed by its data-doc-key (changes
    // when the block's document changes, e.g. expand-context) so repeated
    // F7 presses skip the shadow-root queries; rects are still measured on
    // demand because they change with scroll.
    const rows: Array<{ top: number; el: Element }> = []
    for (const block of root.querySelectorAll('.oh-dsh-multi-diff-block[data-mounted="true"]')) {
      const container = block.querySelector('diffs-container')
      const shadow = container?.shadowRoot
      if (shadow === null || shadow === undefined) continue
      const docKey = block.getAttribute('data-doc-key') ?? ''
      let cached = rowsCacheRef.current.get(block)
      if (cached === undefined || cached.key !== docKey) {
        cached = {
          key: docKey,
          rows: [...shadow.querySelectorAll('[data-line-type^="change-"]')],
        }
        rowsCacheRef.current.set(block, cached)
      }
      for (const row of cached.rows) {
        rows.push({ top: row.getBoundingClientRect().top, el: row })
      }
    }
    if (rows.length === 0) return
    rows.sort((a, b) => a.top - b.top)
    // Anchor on the viewport middle: the centered row lands exactly on it,
    // so the next press advances past it (strict inequality on both sides).
    const rootRect = root.getBoundingClientRect()
    const anchor = rootRect.top + rootRect.height * 0.5
    let target = direction === 1
      ? rows.find(row => row.top > anchor)
      : [...rows].reverse().find(row => row.top < anchor)
    if (target === undefined) target = direction === 1 ? rows[0] : rows[rows.length - 1]
    if (target === undefined) return
    // Scroll only our own container: scrollIntoView would also scroll every
    // scrollable ancestor — including the DSH center column (overflow
    // hidden but still programmatically scrollable), which pushes the tab
    // strip out of view. Instant positioning (no smooth animation) so
    // rapid presses never race an in-flight animation.
    root.scrollTop = root.scrollTop + (target.top - anchor)
  }, [])

  useEffect(() => registerKeymapAction('diff.prevChange', binding({ key: 'F7' }), () => {
    navigateChange(1)
    return true
  }), [navigateChange])

  useEffect(() => registerKeymapAction('diff.nextChange', binding({ shift: true, key: 'F7' }), () => {
    navigateChange(-1)
    return true
  }), [navigateChange])

  const collapseFile = useCallback((path: string) => {
    setRenderedKeys(previous => {
      if (!previous.has(path)) return previous
      const next = new Set(previous)
      next.delete(path)
      return next
    })
  }, [])

  const expandContext = useCallback((file: GitReviewFile) => {
    setExpanding(previous => {
      if (previous.has(file.path)) return previous
      const next = new Set(previous)
      next.add(file.path)
      return next
    })
    void runtime.expandWorktreeFile(surface.staged, file.path, DIFF_CONTEXT_STEP).then(doc => {
      if (doc.phase === 'error') {
        setError(doc.message ?? t('workspace.no-text-diff'))
      }
    }).finally(() => {
      setExpanding(previous => {
        if (!previous.has(file.path)) return previous
        const next = new Set(previous)
        next.delete(file.path)
        return next
      })
    })
  }, [runtime, surface.staged, t])

  const rows = useMemo(() => buildDiffTreeRows(files ?? [], selectedPath, collapsedDirs), [files, selectedPath, collapsedDirs])

  if (error !== '') return <ErrorView message={error} />
  if (list !== undefined && list.phase === 'error') {
    return <ErrorView message={list.message ?? t('overlay.no-content')} />
  }
  if (files === null) {
    return <LoadingView label={t('overlay.loading')} />
  }
  if (files.length === 0) {
    return <ErrorView message={t('workspace.no-text-diff')} />
  }
  return (
    <div className="oh-dsh-diff-all-surface">
      <DiffToolbar
        leading={(
          <span className="oh-dsh-diff-toolbar-title">
            {surface.title}
            <small>{files.length} files</small>
          </span>
        )}
        t={t}
        onPrevChange={() => { navigateChange(-1) }}
        onNextChange={() => { navigateChange(1) }}
      />
      <div className="oh-dsh-diff-all-body">
        <DiffPathTreeNav
          rows={rows}
          onToggleDirectory={key => {
            useSidebarChromeStore.getState().toggleSourceControlDirectory(scopeKey, key)
          }}
          onSelectFile={path => {
            useSidebarChromeStore.getState().setSourceControlSelectedPath(scopeKey, path)
            requestRender(path)
            requestAnimationFrame(() => {
              const block = listRef.current?.querySelector(`[data-path="${CSS.escape(path)}"]`)
              block?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            })
          }}
        />
        <div className="oh-dsh-diff-all-stack" ref={listRef}>
          <MultiDiffFileStack
            files={files}
            renderedKeys={renderedKeys}
            onRequestRender={requestRender}
            onCollapse={collapseFile}
            theme={theme}
            t={t}
            layout={layout}
            wordWrap={wordWrap}
            onExpandContext={expandContext}
          />
          {expanding.size > 0 ? <LoadingView label={t('workspace.loading-diff')} /> : null}
        </div>
      </div>
    </div>
  )
}

/* ---------- commit diff ---------- */

/** Distance beyond the viewport at which a commit file block pre-mounts. */
const COMMIT_BLOCK_MOUNT_MARGIN = '320px 0px'
/** Keep-band around the viewport: farther blocks release their diff body. */
const COMMIT_BLOCK_KEEP_BAND = '1600px 0px'

/**
 * One commit file's details/summary row. The details stay open, but the
 * heavy DiffViewer body mounts lazily when the row scrolls near the
 * viewport and RELEASES (replaced by a same-height placeholder) when the
 * row scrolls far away — a large commit neither builds every Pierre diff
 * upfront nor keeps every rendered block resident.
 */
function CommitFileBlock({
  file,
  theme,
  t,
  cacheBust,
}: {
  file: GitReviewFile
  theme: PierreDiffTheme
  t: Translate<WorkspaceMessage>
  cacheBust: string
}): JSX.Element {
  const [mounted, setMounted] = useState(false)
  const [releasedHeight, setReleasedHeight] = useState<number | null>(null)
  const detailsRef = useRef<HTMLDetailsElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const latestHeightRef = useRef<number | null>(null)

  // Mount-on-approach; a released block re-mounts (drops its same-height
  // placeholder) when the user scrolls back into the mount band.
  useEffect(() => {
    if (mounted && releasedHeight === null) return
    const node = detailsRef.current
    if (node === null) return
    if (typeof IntersectionObserver === 'undefined') {
      setMounted(true)
      setReleasedHeight(null)
      return
    }
    const observer = new IntersectionObserver(
      entries => {
        if (!entries.some(entry => entry.isIntersecting)) return
        if (releasedHeight !== null) {
          setReleasedHeight(null)
        } else {
          setMounted(true)
        }
        observer.disconnect()
      },
      { root: null, rootMargin: COMMIT_BLOCK_MOUNT_MARGIN, threshold: 0.01 },
    )
    observer.observe(node)
    return () => { observer.disconnect() }
  }, [mounted, releasedHeight])

  // Track the body height and release the diff body when the block leaves
  // the keep-band; a same-height placeholder holds the scroll position.
  useEffect(() => {
    if (!mounted || releasedHeight !== null) return
    const node = bodyRef.current
    if (node === null) return
    if (typeof IntersectionObserver === 'undefined' || typeof ResizeObserver === 'undefined') {
      return
    }
    const resizeObserver = new ResizeObserver(entries => {
      const height = entries[0]?.contentRect.height
      if (height !== undefined && height > 0) latestHeightRef.current = height
    })
    resizeObserver.observe(node)
    const releaseObserver = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) {
        const height = latestHeightRef.current
        if (height !== null) setReleasedHeight(height)
      }
    }, { root: null, rootMargin: COMMIT_BLOCK_KEEP_BAND, threshold: 0 })
    releaseObserver.observe(node)
    return () => {
      resizeObserver.disconnect()
      releaseObserver.disconnect()
    }
  }, [mounted, releasedHeight])

  const document = useMemo(() => reviewFileToDiffDocument(file), [file])
  return (
    <details ref={detailsRef} open data-path={file.path}>
      <summary>
        <span title={file.path}>{file.path}</span>
        <small><b>+{file.additions}</b> −{file.deletions}</small>
      </summary>
      <div className="oh-dsh-commit-surface-lines" ref={bodyRef}>
        {releasedHeight !== null ? (
          <div
            className="oh-dsh-commit-released"
            style={{ height: releasedHeight }}
            aria-hidden="true"
          />
        ) : mounted ? (
          <DiffViewer
            document={document}
            theme={theme}
            t={t}
            virtualize={false}
            hideMeta
            cacheBust={cacheBust}
          />
        ) : null}
      </div>
    </details>
  )
}

/** Shared commit file list (lazy-mounted blocks) for commit / committed-all views. */
function CommitFileStack({
  files,
  theme,
  t,
  cacheBust,
}: {
  files: readonly GitReviewFile[]
  theme: PierreDiffTheme
  t: Translate<WorkspaceMessage>
  cacheBust: string
}): JSX.Element {
  return (
    <>
      {files.map(file => (
        <CommitFileBlock key={`${file.oldPath ?? ''}:${file.path}`} file={file} theme={theme} t={t} cacheBust={cacheBust} />
      ))}
      {files.length === 0 && (
        <EmptyView title={t('workspace.no-text-diff')} />
      )}
    </>
  )
}

export function CommitDiffSurfaceView({
  surface,
  t,
}: {
  surface: CommitCenterSurface
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const theme = usePierreDiffTheme()

  // Commit file list lives in the diff runtime; tree chrome is shared.
  const runtime = useMemo(
    () => getDiffRuntime({ sessionId: surface.sessionId, cwd: surface.cwd }),
    [surface.cwd, surface.sessionId],
  )
  useSyncExternalStore(runtime.subscribe, runtime.fingerprint)
  const listKey = commitListKey(surface.hash)
  const list = runtime.getList(listKey)
  const files = list !== undefined && list.phase === 'ready' ? list.files : null
  useEffect(() => {
    if (runtime.getList(listKey) === undefined) {
      void runtime.ensureCommitList(surface.hash)
    }
  }, [runtime, listKey, surface.hash])
  const scopeKey = sidebarScopeKey({ sessionId: surface.sessionId, cwd: surface.cwd })
  const chrome = useSidebarChromeStore(state => state.getSlice(scopeKey))
  const selectedPath = chrome.sourceControl.selectedPath
  const collapsedDirs = useMemo(
    () => new Set(chrome.sourceControl.collapsedDirectories),
    [chrome.sourceControl.collapsedDirectories],
  )
  const rows = useMemo(() => buildDiffTreeRows(files ?? [], selectedPath, collapsedDirs), [files, selectedPath, collapsedDirs])
  if (list !== undefined && list.phase === 'error') {
    return <ErrorView message={list.message ?? t('overlay.no-content')} />
  }
  if (files === null) {
    return <LoadingView label={t('overlay.loading')} />
  }
  return (
    <div className="oh-dsh-commit-surface">
      <div className="oh-dsh-commit-surface-header">
        <span title={surface.hash}>{surface.title}</span>
        <small>{surface.hash.slice(0, 7)}</small>
      </div>
      <div className="oh-dsh-commit-tree-body">
        <DiffPathTreeNav
          rows={rows}
          onToggleDirectory={key => {
            useSidebarChromeStore.getState().toggleSourceControlDirectory(scopeKey, key)
          }}
          onSelectFile={path => {
            useSidebarChromeStore.getState().setSourceControlSelectedPath(scopeKey, path)
            requestAnimationFrame(() => {
              bodyRef.current?.querySelector(`[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            })
          }}
        />
        <div className="oh-dsh-commit-surface-body" ref={bodyRef}>
          <CommitFileStack
            files={files}
            theme={theme}
            t={t}
            cacheBust={`commit:${surface.hash}`}
          />
        </div>
      </div>
    </div>
  )
}

/* ---------- commit-file diff (single file within a commit) ---------- */

export function CommitFileSurfaceView({
  surface,
  t,
}: {
  surface: CommitFileCenterSurface
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const theme = usePierreDiffTheme()
  const runtime = useMemo(
    () => getDiffRuntime({ sessionId: surface.sessionId, cwd: surface.cwd }),
    [surface.cwd, surface.sessionId],
  )
  useSyncExternalStore(runtime.subscribe, runtime.fingerprint)
  const docKey = commitDocKey(surface.hash, surface.filePath)
  const doc = runtime.getDoc(docKey)
  useEffect(() => {
    if (runtime.getDoc(docKey) === undefined) {
      void runtime.ensureCommitDoc(surface.hash, surface.filePath)
    }
  }, [runtime, docKey, surface.hash, surface.filePath])
  const diff = doc !== undefined && doc.phase === 'ready' ? doc.diff : null
  const document = useMemo(
    () => (diff === null ? null : buildDiffDocument({
      path: surface.filePath,
      change: 'modified',
      additions: 0,
      deletions: 0,
      patch: diff,
    })),
    [diff, surface.filePath],
  )
  if (doc !== undefined && doc.phase === 'error') {
    return <ErrorView message={doc.message ?? t('overlay.no-content')} />
  }
  if (doc === undefined || doc.phase === 'loading' || diff === null || document === null) {
    return <LoadingView label={t('overlay.loading')} />
  }
  if (diff.trim() === '') {
    return <ErrorView message={t('workspace.no-text-diff')} />
  }
  return (
    <div className="oh-dsh-diff-surface">
      <div className="oh-dsh-diff-surface-header">
        <span title={surface.filePath}>{surface.filePath}</span>
        <small>{surface.hash.slice(0, 7)}</small>
      </div>
      <div className="oh-dsh-diff-surface-body">
        <DiffViewer
          document={document}
          theme={theme}
          t={t}
          hideMeta
          cacheBust={`${surface.hash}:${surface.filePath}`}
        />
      </div>
    </div>
  )
}

/* ---------- committed-changes diff (against branch upstream) ---------- */

export function CommittedSurfaceView({
  surface,
  t,
}: {
  surface: CommittedCenterSurface
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  if (surface.filePath !== undefined) {
    return <CommittedFileDiffView surface={surface} t={t} />
  }
  return <CommittedAllDiffView surface={surface} t={t} />
}

function CommittedAllDiffView({
  surface,
  t,
}: {
  surface: CommittedCenterSurface
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const theme = usePierreDiffTheme()

  // Committed file list lives in the diff runtime; tree chrome is shared.
  const runtime = useMemo(
    () => getDiffRuntime({ sessionId: surface.sessionId, cwd: surface.cwd }),
    [surface.cwd, surface.sessionId],
  )
  useSyncExternalStore(runtime.subscribe, runtime.fingerprint)
  const listKey = committedListKey(surface.baseRef)
  const list = runtime.getList(listKey)
  const files = list !== undefined && list.phase === 'ready' ? list.files : null
  useEffect(() => {
    if (runtime.getList(listKey) === undefined) {
      void runtime.ensureCommittedList(surface.baseRef)
    }
  }, [runtime, listKey, surface.baseRef])
  const scopeKey = sidebarScopeKey({ sessionId: surface.sessionId, cwd: surface.cwd })
  const chrome = useSidebarChromeStore(state => state.getSlice(scopeKey))
  const selectedPath = chrome.sourceControl.selectedPath
  const collapsedDirs = useMemo(
    () => new Set(chrome.sourceControl.collapsedDirectories),
    [chrome.sourceControl.collapsedDirectories],
  )
  const rows = useMemo(() => buildDiffTreeRows(files ?? [], selectedPath, collapsedDirs), [files, selectedPath, collapsedDirs])
  if (list !== undefined && list.phase === 'error') {
    return <ErrorView message={list.message ?? t('overlay.no-content')} />
  }
  if (files === null) return <LoadingView label={t('overlay.loading')} />
  return (
    <div className="oh-dsh-commit-surface">
      <div className="oh-dsh-commit-surface-header">
        <span>{surface.title}</span>
        <small>{surface.baseRef}</small>
      </div>
      <div className="oh-dsh-commit-tree-body">
        <DiffPathTreeNav
          rows={rows}
          onToggleDirectory={key => {
            useSidebarChromeStore.getState().toggleSourceControlDirectory(scopeKey, key)
          }}
          onSelectFile={path => {
            useSidebarChromeStore.getState().setSourceControlSelectedPath(scopeKey, path)
            requestAnimationFrame(() => {
              bodyRef.current?.querySelector(`[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            })
          }}
        />
        <div className="oh-dsh-commit-surface-body" ref={bodyRef}>
          <CommitFileStack
            files={files}
            theme={theme}
            t={t}
            cacheBust={`committed:${surface.baseRef}`}
          />
        </div>
      </div>
    </div>
  )
}

function CommittedFileDiffView({
  surface,
  t,
}: {
  surface: CommittedCenterSurface
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const filePath = surface.filePath ?? ''
  const theme = usePierreDiffTheme()
  const runtime = useMemo(
    () => getDiffRuntime({ sessionId: surface.sessionId, cwd: surface.cwd }),
    [surface.cwd, surface.sessionId],
  )
  useSyncExternalStore(runtime.subscribe, runtime.fingerprint)
  const docKey = committedDocKey(surface.baseRef, filePath)
  const doc = runtime.getDoc(docKey)
  useEffect(() => {
    if (runtime.getDoc(docKey) === undefined) {
      void runtime.ensureCommittedDoc(surface.baseRef, filePath)
    }
  }, [runtime, docKey, surface.baseRef, filePath])
  const diff = doc !== undefined && doc.phase === 'ready' ? doc.diff : null
  const document = useMemo(
    () => (diff === null ? null : buildDiffDocument({
      path: filePath,
      change: 'modified',
      additions: 0,
      deletions: 0,
      patch: diff,
    })),
    [diff, filePath],
  )
  if (doc !== undefined && doc.phase === 'error') {
    return <ErrorView message={doc.message ?? t('overlay.no-content')} />
  }
  if (doc === undefined || doc.phase === 'loading' || diff === null || document === null) {
    return <LoadingView label={t('overlay.loading')} />
  }
  if (diff.trim() === '') {
    return <ErrorView message={t('workspace.no-text-diff')} />
  }
  return (
    <div className="oh-dsh-diff-surface">
      <div className="oh-dsh-diff-surface-header">
        <span title={filePath}>{filePath}</span>
        <small>{surface.baseRef}</small>
      </div>
      <div className="oh-dsh-diff-surface-body">
        <DiffViewer
          document={document}
          theme={theme}
          t={t}
          hideMeta
          cacheBust={`${surface.baseRef}:${filePath}`}
        />
      </div>
    </div>
  )
}

/* ---------- merge conflict resolver ---------- */

/**
 * Merge-conflict resolver for one conflicted file (git UU/AA/DD). Renders the
 * raw file through @pierre/diffs' UnresolvedFile — conflict markers become
 * region renders with accept actions; accepting writes the resolved content
 * to disk, stages the file (marking it resolved) and swaps the tab to the
 * normal file view.
 *
 * The actions render through `renderMergeConflictUtility`: the react wrapper
 * always installs its own `onMergeConflictAction` state sync (which makes the
 * `onMergeConflictResolve` option unusable), so buttons route through the
 * instance's `handleMergeConflictActionClick` — that path re-renders the
 * region AND syncs the wrapper's React state. The resolved FileContents come
 * from `instance.resolveConflict(...)` before the click handler runs.
 */
export function ConflictSurfaceView({
  surface,
  t,
}: {
  surface: ConflictCenterSurface
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const theme = usePierreDiffTheme()
  const name = basename(surface.filePath)
  // The Git panel hands over git-relative paths; fs.* wire calls want absolute.
  const absolutePath = resolveSidebarPath(surface.cwd, surface.filePath)

  // Content rides the retained file runtime cache (M6 — one read path).
  const runtime = useMemo(
    () => getFileRuntime({ sessionId: surface.sessionId, cwd: surface.cwd }),
    [surface.cwd, surface.sessionId],
  )
  useSyncExternalStore(runtime.subscribe, runtime.fingerprint)
  const entry = runtime.getEntry(absolutePath)
  useEffect(() => {
    void runtime.ensureLoaded(absolutePath)
  }, [runtime, absolutePath])
  const content = entry !== undefined && entry.phase === 'ready'
    && entry.snapshot?.kind === 'text'
    ? entry.snapshot.content
    : null

  const onResolved = useCallback((resolved: FileContents) => {
    setBusy(true)
    betterSidebarApi.fsWrite(
      { sessionId: surface.sessionId, cwd: surface.cwd },
      absolutePath,
      resolved.contents,
    ).then(() => betterSidebarApi.gitStage(
      { sessionId: surface.sessionId, cwd: surface.cwd },
      surface.filePath,
    )).then(() => {
      // Refresh file + git state, then swap this tab for the plain file view.
      getFileRuntime({ sessionId: surface.sessionId, cwd: surface.cwd }).invalidate(absolutePath)
      void getSourceControlRuntime({ sessionId: surface.sessionId, cwd: surface.cwd }).refresh()
      const store = useCenterSurfaceStore.getState()
      store.close(surface.cwd, surface.id)
      store.openFile({
        cwd: surface.cwd,
        sessionId: surface.sessionId,
        filePath: absolutePath,
        title: name,
        preview: false,
      })
    }).catch((cause: unknown) => {
      setBusy(false)
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      toast('error', t('toast.save-failed', { message }))
    })
  }, [absolutePath, surface.cwd, surface.filePath, surface.sessionId, surface.id, name, t])

  const file = useMemo<FileContents>(() => ({
    name,
    contents: content ?? '',
    cacheKey: `conflict:${surface.filePath}`,
  }), [content, name, surface.filePath])

  if (error !== '') return <ErrorView message={error} />
  if (entry !== undefined && entry.phase === 'error') {
    return <ErrorView message={entry.message ?? t('overlay.no-content')} />
  }
  if (entry !== undefined && entry.phase === 'ready' && entry.snapshot !== null && entry.snapshot.kind !== 'text') {
    return <ErrorView message={t('files.viewer.binary')} />
  }
  if (content === null) return <LoadingView label={t('overlay.loading')} />
  return (
    <div className="oh-dsh-conflict-surface" data-testid="conflict-surface">
      <div className="oh-dsh-conflict-header">
        <span title={surface.filePath}>{name}</span>
        <small>Merge conflict</small>
        <span className="oh-dsh-conflict-actions">
          <button type="button" disabled={busy}>{busy ? t('conflict.resolving') : t('conflict.resolve-and-stage')}</button>
        </span>
      </div>
      <div className="oh-dsh-conflict-hint">Choose a resolution below for each conflicted region.</div>
      <Virtualizer className="oh-dsh-conflict-host">
        <UnresolvedFile
          file={file}
          options={{ disableFileHeader: true, theme }}
          renderMergeConflictUtility={(action, getInstance) => {
            const resolve = (resolution: MergeConflictResolution): void => {
              // The react wrapper does not hydrate the original file, so the
              // instance's own resolveConflict returns empty contents — build
              // the resolved text ourselves (same split semantics).
              const resolvedContents = resolveConflictRegionContents(content, action.conflict, resolution)
              const instance = getInstance()
              if (instance !== undefined) {
                // Re-renders the region and syncs the react wrapper state.
                // (Runtime-public field; the .d.ts marks it private.)
                const clickHandle = instance as unknown as {
                  handleMergeConflictActionClick(target: { conflictIndex: number; resolution: MergeConflictResolution }): void
                }
                clickHandle.handleMergeConflictActionClick({ conflictIndex: action.conflictIndex, resolution })
              }
              void onResolved({ name, contents: resolvedContents, cacheKey: `conflict:${surface.filePath}` })
            }
            return (
              <div className="oh-dsh-conflict-actions">
                <button type="button" disabled={busy} onClick={() => { resolve('current') }}>{t('conflict.accept-current')}</button>
                <button type="button" disabled={busy} onClick={() => { resolve('incoming') }}>{t('conflict.accept-incoming')}</button>
                <button type="button" disabled={busy} onClick={() => { resolve('both') }}>{t('conflict.keep-both')}</button>
              </div>
            )
          }}
        />
      </Virtualizer>
    </div>
  )
}

