/**
 * Center surface renderers for the desktop sidebar: diff / commit /
 * conflict / browser views (the file surface lives in file-surface.tsx).
 * Registered into `centerSurfaceRendererRegistry` by the plugin assembly.
 * Each renderer is a pure view over its surface identity — data comes from
 * the runtimes / sidebar API.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Translate } from '../../../../shared/i18n.ts'
import { toast } from '../../../../shared/toast.tsx'
import type { WorkspaceMessage } from '../i18n.ts'
import { betterSidebarApi } from '../better-sidebar-api.ts'
import type { FileContents, MergeConflictResolution } from '@pierre/diffs'
import { UnresolvedFile, Virtualizer } from '@pierre/diffs/react'
import { getFileRuntime, getSourceControlRuntime, resolveSidebarPath } from '../runtimes/registry.ts'
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
import { nextDiffCommentId, readDiffComments, writeDiffComments, commentPathMatches, type DiffComment } from '../diff/diff-comments-store.ts'
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
  const [diff, setDiff] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [context, setContext] = useState(DIFF_CONTEXT_INITIAL)
  const [expanding, setExpanding] = useState(false)
  const [imageDiff, setImageDiff] = useState<{ oldData: string; newData: string } | null>(null)
  const [comments, setComments] = useState<readonly DiffComment[]>(() =>
    readDiffComments().filter(comment =>
      commentPathMatches(comment.filePath, surface.filePath, surface.cwd)
      && comment.createdAt.length > 0,
    ),
  )
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

  // Persisted comments render as Pierre annotation rows on the new-side lines.
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

  useEffect(() => {
    let alive = true
    setDiff(null)
    setError('')
    void betterSidebarApi.gitDiff(
      { sessionId: surface.sessionId, cwd: surface.cwd },
      surface.filePath,
      surface.staged,
      undefined,
      context,
    ).then(response => {
      if (!alive) return
      if (response.diff.trim() === '') {
        setError(t('workspace.no-text-diff'))
        return
      }
      setDiff(response.diff)
    }).catch((cause: unknown) => {
      if (alive) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { alive = false }
  }, [surface.filePath, surface.sessionId, surface.staged, t, context])

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
  if (error !== '') return <ErrorView message={error} />
  if (diff === null || document === null) {
    return <LoadingView label={t('overlay.loading')} />
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
                    const next = comments.filter(candidate => candidate.id !== comment.id)
                    setComments(next)
                    writeDiffComments([
                      ...readDiffComments().filter(candidate => !commentPathMatches(candidate.filePath, surface.filePath, surface.cwd)),
                      ...next,
                    ])
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
              const next = [...comments, comment]
              setComments(next)
              writeDiffComments([...readDiffComments().filter(candidate => !commentPathMatches(candidate.filePath, surface.filePath, surface.cwd)), ...next])
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
  const [files, setFiles] = useState<readonly GitReviewFile[] | null>(null)
  const [error, setError] = useState('')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [renderedKeys, setRenderedKeys] = useState<ReadonlySet<string>>(new Set())
  const [collapsedDirs, setCollapsedDirs] = useState<ReadonlySet<string>>(new Set())
  const [expanding, setExpanding] = useState<ReadonlySet<string>>(new Set())
  const listRef = useRef<HTMLDivElement | null>(null)
  const theme = usePierreDiffTheme()
  const layout = useDiffViewPreferences(state => state.layout)
  const wordWrap = useDiffViewPreferences(state => state.wordWrap)

  useEffect(() => {
    let alive = true
    setFiles(null)
    setError('')
    setRenderedKeys(new Set())
    setSelectedPath(null)
    setCollapsedDirs(new Set())
    setExpanding(new Set())
    const scope = { sessionId: surface.sessionId, cwd: surface.cwd }
    void betterSidebarApi.gitDiff(scope, undefined, surface.staged).then(async result => {
      const parsed = parseGitReviewDiff(result.diff)
      // Untracked files produce no git diff output — synthesize added-file
      // diffs from their contents so "view all" shows them too.
      let untrackedFiles: GitReviewFile[] = []
      if (!surface.staged) {
        try {
          const status = await betterSidebarApi.gitStatus(scope)
          const untracked = status.entries
            .filter(entry => entry.xy === '??')
            .map(entry => entry.path)
          const synthesized = await Promise.all(untracked.map(async (path): Promise<GitReviewFile | null> => {
            const read = await betterSidebarApi.fsRead(scope, resolveSidebarPath(surface.cwd, path))
            if (read.kind !== 'text') return null
            const lines = read.content.split('\n')
            return {
              path,
              oldPath: null,
              status: 'added',
              additions: lines.length,
              deletions: 0,
              lines: lines.map((content, index) => ({
                key: `untracked:${path}:${index}`,
                type: 'addition' as const,
                content,
                oldLine: null,
                newLine: index + 1,
              })),
            }
          }))
          untrackedFiles = synthesized.filter((file): file is GitReviewFile => file !== null)
        } catch (cause) {
          console.warn('[sidebar] failed to synthesize untracked-file diffs', cause)
          untrackedFiles = []
        }
      }
      if (!alive) return
      const allFiles = [...parsed, ...untrackedFiles]
      if (allFiles.length === 0) {
        setError(t('workspace.no-text-diff'))
        return
      }
      setFiles(allFiles)
      setRenderedKeys(new Set(allFiles.slice(0, DIFF_ALL_PREMOUNT_COUNT).map(file => file.path)))
    }).catch((cause: unknown) => {
      if (alive) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { alive = false }
  }, [surface.sessionId, surface.cwd, surface.staged, t])

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
    // Pierre rows live in each block's diffs-container shadow root.
    const rows: Array<{ top: number; el: Element }> = []
    for (const block of root.querySelectorAll('.oh-dsh-multi-diff-block[data-mounted="true"]')) {
      const container = block.querySelector('diffs-container')
      const shadow = container?.shadowRoot
      if (shadow === null || shadow === undefined) continue
      for (const row of shadow.querySelectorAll('[data-line-type^="change-"]')) {
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
    void betterSidebarApi.gitDiff(
      { sessionId: surface.sessionId, cwd: surface.cwd },
      file.path,
      surface.staged,
      undefined,
      DIFF_CONTEXT_STEP,
    ).then(result => {
      const reparsed = parseGitReviewDiff(result.diff)
      const nextFile = reparsed.find(candidate => candidate.path === file.path) ?? reparsed[0]
      setFiles(previous => {
        if (previous === null) return previous
        const next = previous.map(candidate => candidate.path === file.path && nextFile !== undefined ? nextFile : candidate)
        return next
      })
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => {
      setExpanding(previous => {
        if (!previous.has(file.path)) return previous
        const next = new Set(previous)
        next.delete(file.path)
        return next
      })
    })
  }, [surface.sessionId, surface.cwd, surface.staged])

  const rows = useMemo(() => buildDiffTreeRows(files ?? [], selectedPath, collapsedDirs), [files, selectedPath, collapsedDirs])

  if (error !== '') return <ErrorView message={error} />
  if (files === null) {
    return <LoadingView label={t('overlay.loading')} />
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
            setCollapsedDirs(previous => {
              const next = new Set(previous)
              if (next.has(key)) next.delete(key)
              else next.add(key)
              return next
            })
          }}
          onSelectFile={path => {
            setSelectedPath(path)
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

/**
 * One commit file's details/summary row. The details stay open, but the
 * heavy DiffViewer body mounts lazily when the row scrolls near the
 * viewport — a large commit no longer builds every Pierre diff upfront.
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
  const rowRef = useRef<HTMLDetailsElement | null>(null)
  useEffect(() => {
    const node = rowRef.current
    if (node === null) return
    if (typeof IntersectionObserver === 'undefined') {
      setMounted(true)
      return
    }
    const observer = new IntersectionObserver(
      entries => {
        if (!entries.some(entry => entry.isIntersecting)) return
        setMounted(true)
        observer.disconnect()
      },
      { root: null, rootMargin: COMMIT_BLOCK_MOUNT_MARGIN, threshold: 0.01 },
    )
    observer.observe(node)
    return () => { observer.disconnect() }
  }, [])
  const document = useMemo(() => reviewFileToDiffDocument(file), [file])
  return (
    <details ref={rowRef} open data-path={file.path}>
      <summary>
        <span title={file.path}>{file.path}</span>
        <small><b>+{file.additions}</b> −{file.deletions}</small>
      </summary>
      <div className="oh-dsh-commit-surface-lines">
        {mounted ? (
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
  const [files, setFiles] = useState<readonly GitReviewFile[] | null>(null)
  const [error, setError] = useState('')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [collapsedDirs, setCollapsedDirs] = useState<ReadonlySet<string>>(new Set())
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const theme = usePierreDiffTheme()
  useEffect(() => {
    let alive = true
    setFiles(null)
    setError('')
    setSelectedPath(null)
    void betterSidebarApi.gitCommitDiff(
      { sessionId: surface.sessionId, cwd: surface.cwd },
      surface.hash,
    ).then(result => {
      if (!alive) return
      setFiles(parseGitReviewDiff(result.diff))
    }).catch((cause: unknown) => {
      if (alive) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { alive = false }
  }, [surface.hash, surface.sessionId, surface.cwd])
  const rows = useMemo(() => buildDiffTreeRows(files ?? [], selectedPath, collapsedDirs), [files, selectedPath, collapsedDirs])
  if (error !== '') return <ErrorView message={error} />
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
            setCollapsedDirs(previous => {
              const next = new Set(previous)
              if (next.has(key)) next.delete(key)
              else next.add(key)
              return next
            })
          }}
          onSelectFile={path => {
            setSelectedPath(path)
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
  const [diff, setDiff] = useState<string | null>(null)
  const [error, setError] = useState('')
  const theme = usePierreDiffTheme()
  useEffect(() => {
    let alive = true
    setDiff(null)
    setError('')
    void betterSidebarApi.gitCommitFileDiff(
      { sessionId: surface.sessionId, cwd: surface.cwd },
      surface.hash,
      surface.filePath,
    ).then(response => {
      if (!alive) return
      if (response.diff.trim() === '') {
        setError(t('workspace.no-text-diff'))
        return
      }
      setDiff(response.diff)
    }).catch((cause: unknown) => {
      if (alive) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { alive = false }
  }, [surface.hash, surface.filePath, surface.sessionId, surface.cwd, t])
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
  if (error !== '') return <ErrorView message={error} />
  if (diff === null || document === null) {
    return <LoadingView label={t('overlay.loading')} />
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
  const [files, setFiles] = useState<readonly GitReviewFile[] | null>(null)
  const [error, setError] = useState('')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [collapsedDirs, setCollapsedDirs] = useState<ReadonlySet<string>>(new Set())
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const theme = usePierreDiffTheme()
  useEffect(() => {
    let alive = true
    setFiles(null)
    setError('')
    setSelectedPath(null)
    void betterSidebarApi.gitCommittedDiff(
      { sessionId: surface.sessionId, cwd: surface.cwd },
      surface.baseRef,
      undefined,
    ).then(result => {
      if (!alive) return
      setFiles(parseGitReviewDiff(result.diff))
    }).catch((cause: unknown) => {
      if (alive) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { alive = false }
  }, [surface.baseRef, surface.sessionId, surface.cwd])
  const rows = useMemo(() => buildDiffTreeRows(files ?? [], selectedPath, collapsedDirs), [files, selectedPath, collapsedDirs])
  if (error !== '') return <ErrorView message={error} />
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
            setCollapsedDirs(previous => {
              const next = new Set(previous)
              if (next.has(key)) next.delete(key)
              else next.add(key)
              return next
            })
          }}
          onSelectFile={path => {
            setSelectedPath(path)
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
  const [diff, setDiff] = useState<string | null>(null)
  const [error, setError] = useState('')
  const theme = usePierreDiffTheme()
  useEffect(() => {
    let alive = true
    setDiff(null)
    setError('')
    void betterSidebarApi.gitCommittedDiff(
      { sessionId: surface.sessionId, cwd: surface.cwd },
      surface.baseRef,
      filePath,
    ).then(response => {
      if (!alive) return
      if (response.diff.trim() === '') {
        setError(t('workspace.no-text-diff'))
        return
      }
      setDiff(response.diff)
    }).catch((cause: unknown) => {
      if (alive) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { alive = false }
  }, [surface.baseRef, filePath, surface.sessionId, surface.cwd, t])
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
  if (error !== '') return <ErrorView message={error} />
  if (diff === null || document === null) {
    return <LoadingView label={t('overlay.loading')} />
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
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const theme = usePierreDiffTheme()
  const name = surface.filePath.split(/[\\/]/).filter(Boolean).pop() ?? surface.filePath
  // The Git panel hands over git-relative paths; fs.* wire calls want absolute.
  const absolutePath = resolveSidebarPath(surface.cwd, surface.filePath)

  useEffect(() => {
    let alive = true
    setContent(null)
    setError('')
    void betterSidebarApi.fsRead(
      { sessionId: surface.sessionId, cwd: surface.cwd },
      absolutePath,
    ).then(result => {
      if (!alive) return
      if (result.kind !== 'text') {
        setError(t('files.viewer.binary'))
        return
      }
      setContent(result.content)
    }).catch((cause: unknown) => {
      if (alive) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { alive = false }
  }, [absolutePath, surface.sessionId, surface.cwd, t])

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

