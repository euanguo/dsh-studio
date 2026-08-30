/**
 * Center surface renderers for the WORKTREE DIFF views: the single-file
 * diff and the change-area "view all" stack. Data comes from the retained
 * diff runtime; tree selection / collapsed directories are chrome (shared
 * with the source-control panel).
 */
import { SidebarSurfaceCss as surfaceCss } from '../styles.js'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Translate } from '@dsh-studio/shared/i18n'
import type { WorkspaceMessage } from '../i18n.ts'
import { getDiffRuntime, sidebarScopeKey } from '../runtimes/registry.ts'
import { useSidebarChromeStore } from '../runtimes/chrome-store.ts'
import { worktreeDocKey, worktreeListKey, worktreeImageKey } from '../runtimes/diff-runtime.ts'
import { binding, registerKeymapAction } from '../kit/keymap.ts'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { EmptyState, ErrorState, LoadingState } from '@dsh-studio/shared/ui'
import { DiffViewer } from '../diff/diff-viewer.tsx'
import { DiffToolbar } from '../diff/diff-toolbar.tsx'
import { ScrollArea } from '@dsh-studio/shared/ui'
import { useDiffViewPreferences } from '../diff/diff-view-preferences.ts'
import { DiffPathTreeNav, type DiffPathTreeRow } from '../diff/path-tree-nav.tsx'
import { buildDiffTreeRows } from '../diff/diff-path-tree.ts'
import { MultiDiffFileStack } from '../diff/multi-diff-file-stack.tsx'
import { ImageDiffViewer } from '../diff/image-diff-viewer.tsx'
import { useDiffCommentsStore, commentBelongsToCwd, commentPathMatches, type WorkbenchComment } from '../diff/diff-comments-store.ts'
import { commentsToDiffLineAnnotations } from '../diff/comment-annotations.ts'
import { CommentBubble } from '../diff/comment-bubble.tsx'
import { buildDiffDocument } from '../diff/file-diff.ts'
import { usePierreDiffTheme } from '../diff/pierre-adapter.tsx'
import { useCommentRails } from '../comments/comment-rails.tsx'
import { useSelectionActionOverlay, commentAnchorOf } from '../selection/use-selection-action.tsx'
import { insertReferenceIntoConversation } from '../selection/conversation-targets.ts'
import { formatSelectionLabel } from '../selection/selection-reference.ts'
import { buildCommentReference } from '../comments/comment-rails-core.ts'
import type { SessionsService } from '../client-types.ts'
import type { GitReviewFile } from '../diff/git-review-diff.ts'
import type { DiffImageEntry } from '../runtimes/diff-runtime.ts'
import type { DiffAllCenterSurface, DiffCenterSurface } from './types.ts'

/** Single-file diff render caps (fall back to the too-large notice). */
const DIFF_MAX_RENDER_LINES = 120_000
const DIFF_MAX_RENDER_CHARS = 6_000_000
/** "Expand context" bounds: start, step, ceiling (lines). */
const DIFF_CONTEXT_INITIAL = 3
const DIFF_CONTEXT_LIMIT = 200
const DIFF_CONTEXT_STEP = 20
/** Files pre-mounted in a diff-all stack (the rest mount on scroll). */
const DIFF_ALL_PREMOUNT_COUNT = 6

export function DiffSurfaceView({
  surface,
  t,
  sessions,
}: {
  surface: DiffCenterSurface
  t: Translate<WorkspaceMessage>
  sessions?: SessionsService
}): JSX.Element {
  const [context, setContext] = useState(DIFF_CONTEXT_INITIAL)
  const [expanding, setExpanding] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // Cooldown after "Expand context" (the button re-enables when it fires).
  const expandTimerRef = useRef<number | null>(null)
  useEffect(() => () => {
    if (expandTimerRef.current !== null) window.clearTimeout(expandTimerRef.current)
  }, [])
  const isImagePath = /\.(png|jpe?g|gif|webp|bmp|ico|svg|avif)$/i.test(surface.filePath)
  const theme = usePierreDiffTheme()
  const layout = useDiffViewPreferences(surface.cwd).layout
  const wordWrap = useDiffViewPreferences(surface.cwd).wordWrap

  // The diff document lives in the retained diff runtime (M1): re-opening
  // this tab renders instantly from the cached entry.
  const runtime = useMemo(
    () => getDiffRuntime({ cwd: surface.cwd }),
    [surface.cwd],
  )
  useSyncExternalStore(runtime.subscribe, runtime.fingerprint)
  const docKey = worktreeDocKey(surface.staged, surface.filePath, context)
  const doc = runtime.getDoc(docKey)
  const imageKey = worktreeImageKey(surface.staged, surface.filePath)
  // Binary base64 payloads are cached in the runtime too (D8/D9): a failed
  // fetch renders an error branch with retry, never a permanent spinner.
  const imageDoc = runtime.get(imageKey) as DiffImageEntry | undefined
  useEffect(() => {
    if (runtime.getDoc(docKey) === undefined) {
      void runtime.ensureWorktreeDoc(surface.staged, surface.filePath, context)
    }
  }, [runtime, docKey, surface.staged, surface.filePath, context])
  const diff = doc !== undefined && doc.phase === 'ready' ? doc.diff : null
  const isBinaryDiff = diff !== null
    && isImagePath
    && diff.includes('Binary files ')
    && diff.includes(' differ')
  useEffect(() => {
    if (!isBinaryDiff) return
    if (runtime.get(imageKey) === undefined) {
      void runtime.ensureImageDiff(surface.staged, surface.filePath)
    }
  }, [isBinaryDiff, runtime, imageKey, surface.staged, surface.filePath])

  // Persisted comments render as Pierre annotation rows on the new-side
  // lines; the store is the single live source (M5 — no local mirror).
  const allComments = useDiffCommentsStore(state => state.comments)
  const comments = useMemo(
    () => allComments.filter(comment =>
      commentBelongsToCwd(comment, surface.cwd)
      && commentPathMatches(comment.path, surface.filePath, surface.cwd)
      && comment.createdAt.length > 0,
    ),
    [allComments, surface.cwd, surface.filePath],
  )
  const rails = useCommentRails({
    path: surface.filePath,
    cwd: surface.cwd,
    comments,
    t,
    layer: typeof window === 'undefined' ? null : window.document.body,
    onAdd: input => {
      useDiffCommentsStore.getState().addComment({
        ...input,
        cwd: surface.cwd,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      })
    },
    onResolve: id => { useDiffCommentsStore.getState().resolveComment(id) },
    onUnresolve: id => { useDiffCommentsStore.getState().unresolveComment(id) },
    ...(sessions === null || sessions === undefined
      ? {}
      : {
          onReference: input => {
            const snapshot = sessions!.list.getSnapshot()
            const target = snapshot.current ?? Object.keys(snapshot.byId)[0]
            if (target === undefined) return 'unavailable'
            // Send the comment as an inline reference chip into the
            // conversation draft (issues at submit via the registered
            // `dsh-studio-selection` slash source).
            return insertReferenceIntoConversation(sessions!, target, {
              label: formatSelectionLabel({
                path: input.path,
                span: { startLine: input.line, endLine: input.line },
              }),
              clipboardText: buildCommentReference(input.path, input.line, input.body),
            })
          },
        }),
  })

  const lineAnnotations = useMemo(
    () => commentsToDiffLineAnnotations(comments),
    [comments],
  )
  const renderCommentAnnotation = useCallback((annotation: { metadata?: WorkbenchComment }) => {
    if (annotation.metadata === undefined) return null
    return (
      <CommentBubble
        comment={annotation.metadata}
        t={t}
        onResolve={id => { useDiffCommentsStore.getState().resolveComment(id) }}
        onUnresolve={id => { useDiffCommentsStore.getState().unresolveComment(id) }}
        onRemove={id => { useDiffCommentsStore.getState().removeComment(id) }}
      />
    )
  }, [t])

  const selectionAction = useSelectionActionOverlay({
    containerRef: scrollRef,
    path: surface.filePath,
    cwd: surface.cwd,
    layer: typeof window === 'undefined' ? null : window.document.body,
    sessions: sessions ?? null,
    onComment: anchor => {
      rails.composeAt(commentAnchorOf(anchor))
    },
    t,
  })

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
  const retryImageDiff = useCallback((): void => {
    if (!isBinaryDiff) return
    void runtime.ensureImageDiff(surface.staged, surface.filePath)
  }, [isBinaryDiff, runtime, surface.staged, surface.filePath])

  if (doc !== undefined && doc.phase === 'error') {
    return <ErrorState message={doc.message ?? t('overlay.no-content')} />
  }
  if (doc === undefined || doc.phase === 'loading' || diff === null || document === null) {
    return <LoadingState label={t('overlay.loading')} />
  }
  if (diff.trim() === '') {
    return <ErrorState message={t('workspace.no-text-diff')} />
  }
  if (diff.includes('Binary files ') && diff.includes(' differ')) {
    return (
      <div className={surfaceCss["dsh-studio-diff-surface"]}>
        <DiffToolbar t={t} cwd={surface.cwd} />
        {imageDoc !== undefined && imageDoc.phase === 'ready' && imageDoc.data !== null ? (
          <ScrollArea className="dsh-studio-diff-surface-body">
            <ImageDiffViewer
              oldData={imageDoc.data.oldData}
              newData={imageDoc.data.newData}
              oldLabel={`Original · ${surface.filePath}`}
              newLabel={`Modified · ${surface.filePath}`}
            />
          </ScrollArea>
        ) : imageDoc?.phase === 'error' ? (
          <div className="dsh-studio-diff-surface-body">
            <ErrorState
              message={t('files.image-load-failed')}
              description={imageDoc.message ?? ''}
              action={(
                <Button variant="outline" size="sm" onClick={retryImageDiff}>
                  {t('overlay.retry')}
                </Button>
              )}
            />
          </div>
        ) : (
          <LoadingState label={t('workspace.loading-diff')} />
        )}
      </div>
    )
  }
  if (document.lines.length > DIFF_MAX_RENDER_LINES || diff.length > DIFF_MAX_RENDER_CHARS) {
    return (
      <div className={surfaceCss["dsh-studio-diff-surface"]}>
        <DiffToolbar t={t} cwd={surface.cwd} />
        <EmptyState title={t('diff.too-large', { lines: document.lines.length })} />
      </div>
    )
  }
  return (
    <div className={surfaceCss["dsh-studio-diff-surface"]}>
      <DiffToolbar
        leading={(
          <span className={surfaceCss["dsh-studio-diff-toolbar-title"]}>
            <span title={surface.filePath}>{surface.filePath}</span>
            <small>{surface.staged ? t('source-control.section.staged') : t('source-control.section.unstaged')}</small>
          </span>
        )}
        t={t}
        cwd={surface.cwd}
      />
      <ScrollArea className="dsh-studio-diff-surface-body" ref={scrollRef}>
        {rails.overlay()}
        {selectionAction.overlay}
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
          onLineEnter={rails.onLineEnter}
          onLineLeave={rails.onLineLeave}
          renderGutterUtility={rails.gutterUtility}
        />
      </ScrollArea>
      <div className={surfaceCss["dsh-studio-diff-context-bar"]}>
        <Button
          variant="outline"
          size="sm"
          disabled={expanding || context >= DIFF_CONTEXT_LIMIT}
          onClick={() => {
            setExpanding(true)
            setContext(value => Math.min(DIFF_CONTEXT_LIMIT, value + DIFF_CONTEXT_STEP))
            if (expandTimerRef.current !== null) window.clearTimeout(expandTimerRef.current)
            expandTimerRef.current = window.setTimeout(() => setExpanding(false), 1200)
          }}
        >
          {expanding ? t('workspace.loading-diff') : t('diff.expand-context', { current: context, next: Math.min(DIFF_CONTEXT_LIMIT, context + DIFF_CONTEXT_STEP) })}
        </Button>
      </div>
    </div>
  )
}

/* ---------- diff-all (section "view all") ---------- */

export function DiffAllSurfaceView({
  surface,
  t,
  sessions,
}: {
  surface: DiffAllCenterSurface
  t: Translate<WorkspaceMessage>
  sessions?: SessionsService
}): JSX.Element {
  const [renderedKeys, setRenderedKeys] = useState<ReadonlySet<string>>(new Set())
  const [expanding, setExpanding] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)
  // F7 navigation cache: block element → its change-row list + doc key.
  const rowsCacheRef = useRef(new WeakMap<Element, { key: string; rows: Element[] }>())
  const theme = usePierreDiffTheme()
  const layout = useDiffViewPreferences(surface.cwd).layout
  const wordWrap = useDiffViewPreferences(surface.cwd).wordWrap

  // The change list lives in the retained diff runtime (M1); selection and
  // collapsed directories are chrome (shared with the source-control panel).
  const runtime = useMemo(
    () => getDiffRuntime({ cwd: surface.cwd }),
    [surface.cwd],
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
  const scopeKey = sidebarScopeKey({ cwd: surface.cwd })
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
    for (const block of root.querySelectorAll('.dsh-studio-multi-diff-block[data-mounted="true"]')) {
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

  if (error !== '') return <ErrorState message={error} />
  if (list !== undefined && list.phase === 'error') {
    return <ErrorState message={list.message ?? t('overlay.no-content')} />
  }
  if (files === null) {
    return <LoadingState label={t('overlay.loading')} />
  }
  if (files.length === 0) {
    return <ErrorState message={t('workspace.no-text-diff')} />
  }
  return (
    <div className={surfaceCss["dsh-studio-diff-all-surface"]}>
      <DiffToolbar
        leading={(
          <span className={surfaceCss["dsh-studio-diff-toolbar-title"]}>
            {surface.title}
            <small>{files.length} files</small>
          </span>
        )}
        t={t}
        cwd={surface.cwd}
        onPrevChange={() => { navigateChange(-1) }}
        onNextChange={() => { navigateChange(1) }}
      />
      <div className={surfaceCss["dsh-studio-diff-all-body"]}>
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
        <ScrollArea className={surfaceCss["dsh-studio-diff-all-stack"]} ref={listRef}>
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
            cwd={surface.cwd}
            {...(sessions === undefined ? {} : { sessions })}
          />
          {expanding.size > 0 ? <LoadingState label={t('workspace.loading-diff')} /> : null}
        </ScrollArea>
      </div>
    </div>
  )
}
