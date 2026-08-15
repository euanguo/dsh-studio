/**
 * Center surface renderers for the desktop sidebar: file / diff / browser.
 * Registered into `centerSurfaceRendererRegistry` by the plugin assembly.
 * Each renderer is a pure view over its surface identity — data comes from
 * the runtimes / sidebar API.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Translate } from '../../../../shared/i18n.ts'
import type { WorkspaceMessage } from '../i18n.ts'
import { betterSidebarApi } from '../better-sidebar-api.ts'
import type { FileContents, MergeConflictResolution } from '@pierre/diffs'
import { Editor, type EditorOptions } from '@pierre/diffs/edit'
import { EditProvider, File as PierreFile, UnresolvedFile, Virtualizer } from '@pierre/diffs/react'
import { getFileRuntime, getSourceControlRuntime, resolveSidebarPath } from '../runtimes/registry.ts'
import { ContentViewer } from '../files/content-viewer.tsx'
import { FileViewerChrome, type MarkdownViewMode } from '../files/file-viewer-chrome.tsx'
import { toggleMarkdownTaskMarker } from '../files/markdown-task-list.ts'
import { formatFileSelectionReference, getLineSelectionWithin } from '../files/file-selection-reference.ts'
import { useCenterSurfaceStore } from './center-surface-store.ts'
import { DiffViewer } from '../diff/diff-viewer.tsx'
import { DiffToolbar } from '../diff/diff-toolbar.tsx'
import { useDiffViewPreferences } from '../diff/diff-view-preferences.ts'
import { DiffPathTreeNav, type DiffPathTreeRow } from '../diff/path-tree-nav.tsx'
import { buildDiffTreeRows } from '../diff/diff-path-tree.ts'
import { MultiDiffFileStack } from '../diff/multi-diff-file-stack.tsx'
import { ImageDiffViewer } from '../diff/image-diff-viewer.tsx'
import { nextDiffCommentId, readDiffComments, writeDiffComments, commentPathMatches, type DiffComment } from '../diff/diff-comments-store.ts'
import { commentsToDiffLineAnnotations, commentsToFileLineAnnotations } from '../diff/comment-annotations.ts'
import { CommentBubble } from '../diff/comment-bubble.tsx'
import { resolveConflictRegionContents } from '../diff/merge-conflict-resolve.ts'
import { buildDiffDocument } from '../diff/file-diff.ts'
import { usePierreDiffTheme } from '../diff/pierre-adapter.tsx'
import { parseGitReviewDiff, reviewFileToDiffDocument } from '../review/review-diff.ts'
import type { GitReviewFile } from '../review/review-types.ts'
import type {
  CommitCenterSurface,
  CommitFileCenterSurface,
  CommittedCenterSurface,
  ConflictCenterSurface,
  DiffAllCenterSurface,
  DiffCenterSurface,
  EditorCenterSurface,
  FileCenterSurface,
} from './types.ts'

/* ---------- file ---------- */

export function FileSurfaceView({
  surface,
  t,
}: {
  surface: FileCenterSurface
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const runtime = useMemo(
    () => getFileRuntime({ sessionId: surface.sessionId, cwd: surface.cwd }),
    [surface.cwd, surface.sessionId],
  )
  const [fingerprint, setFingerprint] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [writeError, setWriteError] = useState('')
  const [selectionAction, setSelectionAction] = useState<{
    left: number
    top: number
    label: string
  } | null>(null)

  // Persisted diff comments also hang on the file's own lines (one comment
  // system across diff / file / editor surfaces).
  const comments = useMemo(
    () => readDiffComments().filter(comment =>
      commentPathMatches(comment.filePath, surface.filePath, surface.cwd)
      && comment.createdAt.length > 0,
    ),
    [surface.cwd, surface.filePath, fingerprint],
  )

  useEffect(() => {
    let alive = true
    if (reloadKey > 0) runtime.invalidate(surface.filePath)
    void runtime.ensureLoaded(surface.filePath).then(() => {
      if (alive) setFingerprint(runtime.fingerprint())
    })
    return () => { alive = false }
  }, [runtime, surface.filePath, reloadKey])

  const isMarkdown = /\.(md|mdx|markdown)$/i.test(surface.filePath)
  const markdownMode: MarkdownViewMode = surface.markdownPreview === true ? 'preview' : 'source'

  const onMarkdownModeChange = useCallback((mode: MarkdownViewMode) => {
    useCenterSurfaceStore.getState().setFileMarkdownPreview(
      surface.cwd,
      surface.id,
      mode === 'preview',
    )
  }, [surface.cwd, surface.id])

  const writeQueueRef = useRef(Promise.resolve())
  const onTaskToggle = useCallback(({ sourceLine, checked }: { sourceLine: number; checked: boolean }) => {
    const entry = runtime.getEntry(surface.filePath)
    const snapshot = entry?.phase === 'ready' ? entry.snapshot : null
    if (snapshot === null || snapshot.kind !== 'text' || snapshot.content === null || snapshot.truncated) return
    const next = toggleMarkdownTaskMarker(snapshot.content, sourceLine, checked)
    if (next === null) return
    setWriteError('')
    writeQueueRef.current = writeQueueRef.current
      .then(() => betterSidebarApi.fsWrite(
        { sessionId: surface.sessionId, cwd: surface.cwd },
        surface.filePath,
        next,
      ))
      .then(() => {
        runtime.invalidate(surface.filePath)
        setFingerprint(runtime.fingerprint())
        void runtime.ensureLoaded(surface.filePath)
      })
      .catch((cause: unknown) => {
        runtime.invalidate(surface.filePath)
        void runtime.ensureLoaded(surface.filePath)
        setWriteError(cause instanceof Error ? cause.message : String(cause))
      })
  }, [runtime, surface.cwd, surface.filePath, surface.sessionId])

  const onOpenExternal = useCallback(() => {
    if (window.dshDesktop !== undefined) {
      void window.dshDesktop.openExternal(surface.filePath)
    }
  }, [surface.filePath])

  const onEdit = useCallback(() => {
    useCenterSurfaceStore.getState().openEditor({
      cwd: surface.cwd,
      sessionId: surface.sessionId,
      filePath: surface.filePath,
    })
  }, [surface.cwd, surface.filePath, surface.sessionId])

  const onSourceMouseUp = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (isMarkdown && markdownMode === 'preview') {
      setSelectionAction(null)
      return
    }
    const selection = getLineSelectionWithin(event.currentTarget)
    if (selection === null) {
      setSelectionAction(null)
      return
    }
    setSelectionAction({
      left: event.clientX,
      top: event.clientY,
      label: formatFileSelectionReference({ path: surface.filePath, selection }),
    })
  }, [isMarkdown, markdownMode, surface.filePath])

  const onCopySelection = useCallback(async (label: string) => {
    try {
      await navigator.clipboard.writeText(label)
    } catch {
      // Clipboard can be unavailable in sandboxed web contexts; best effort.
    }
    setSelectionAction(null)
  }, [])

  const entry = runtime.getEntry(surface.filePath)
  if (entry === undefined || entry.phase === 'loading') {
    return <div className="oh-dsh-side-muted">{t('overlay.loading')}</div>
  }
  if (entry.phase === 'error' || entry.snapshot === null) {
    return (
      <div className="oh-dsh-side-error" role="alert">
        <span>{entry.message ?? t('overlay.no-content')}</span>
        <button type="button" onClick={() => {
          runtime.invalidate(surface.filePath)
          setReloadKey(value => value + 1)
        }}>Retry</button>
      </div>
    )
  }
  const snapshot = entry.snapshot
  const content = snapshot.kind === 'text' ? snapshot.content : null
  const lineCount = content === null ? 0 : content.split('\n').length
  return (
    <div className="oh-dsh-file-surface" data-testid="file-surface">
      <FileViewerChrome
        cwd={surface.cwd}
        filePath={surface.filePath}
        isMarkdown={isMarkdown}
        markdownMode={markdownMode}
        onMarkdownModeChange={onMarkdownModeChange}
        truncated={snapshot.truncated}
        meta={content === null ? null : `${lineCount} lines`}
        onOpenExternal={onOpenExternal}
        {...(content === null ? {} : { onEdit })}
      />
      {writeError !== '' ? (
        <div className="oh-dsh-side-error" role="alert">{writeError}</div>
      ) : null}
      <div className="oh-dsh-file-surface-body" onMouseUp={onSourceMouseUp}>
        <ContentViewer
          path={surface.filePath}
          content={content}
          binary={snapshot.binary}
          size={snapshot.size}
          truncated={snapshot.truncated}
          markdownPreview={markdownMode === 'preview'}
          comments={comments}
          onTaskToggle={onTaskToggle}
          onOpenExternal={onOpenExternal}
          {...(snapshot.data === undefined ? {} : { data: snapshot.data })}
          t={t}
        />
      </div>
      {selectionAction !== null ? (
        <div
          className="oh-dsh-file-selection-action"
          style={{ left: selectionAction.left, top: selectionAction.top }}
        >
          <button type="button" onClick={() => { void onCopySelection(selectionAction.label) }}>
            Copy {selectionAction.label}
          </button>
        </div>
      ) : null}
    </div>
  )
}

/* ---------- editor ---------- */

function createPierreEditor<LAnnotation>(options: EditorOptions<LAnnotation>): Editor<LAnnotation> {
  return new Editor(options)
}

export function EditorSurfaceView({
  surface,
  t,
}: {
  surface: EditorCenterSurface
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const latestContentRef = useRef('')
  const autosaveTimerRef = useRef<number | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [readOnly, setReadOnly] = useState(false)
  const theme = usePierreDiffTheme()

  // Persisted diff comments also hang on the editor's lines (display only —
  // adding happens from the diff surface's line gutter).
  const comments = useMemo(
    () => readDiffComments().filter(comment =>
      commentPathMatches(comment.filePath, surface.filePath, surface.cwd)
      && comment.createdAt.length > 0,
    ),
    [surface.cwd, surface.filePath],
  )
  const lineAnnotations = useMemo(
    () => commentsToFileLineAnnotations(comments),
    [comments],
  )

  const save = useCallback((nextContent?: string) => {
    const value = nextContent ?? latestContentRef.current
    if (value === '') {
      // Empty content is a valid save; still write it below.
    }
    setSaving(true)
    betterSidebarApi.fsWrite(
      { sessionId: surface.sessionId, cwd: surface.cwd },
      surface.filePath,
      value,
    ).then(() => {
      setDirty(false)
      setError('')
      // Refresh the file runtime so other file tabs see the new content.
      getFileRuntime({ sessionId: surface.sessionId, cwd: surface.cwd }).invalidate(surface.filePath)
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => { setSaving(false) })
  }, [surface.cwd, surface.filePath, surface.sessionId])

  useEffect(() => {
    let alive = true
    setContent(null)
    setError('')
    setDirty(false)
    latestContentRef.current = ''
    void betterSidebarApi.fsRead(
      { sessionId: surface.sessionId, cwd: surface.cwd },
      surface.filePath,
    ).then(result => {
      if (!alive) return
      if (result.kind !== 'text') {
        setError(t('files.viewer.binary'))
        return
      }
      latestContentRef.current = result.content
      setContent(result.content)
    }).catch((cause: unknown) => {
      if (alive) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => {
      alive = false
      if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current)
    }
  }, [surface.cwd, surface.filePath, surface.sessionId, t])

  const file = useMemo<FileContents>(() => ({
    name: surface.filePath.split(/[\\/]/).filter(Boolean).pop() ?? surface.filePath,
    contents: content ?? '',
    cacheKey: `editor:${surface.filePath}`,
  }), [content, surface.filePath])

  const editorOptions = useMemo<EditorOptions<DiffComment>>(() => ({
    persistState: false,
    onChange: nextFile => {
      latestContentRef.current = nextFile.contents
      setDirty(true)
      if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = window.setTimeout(() => { save(nextFile.contents) }, 1000)
    },
  }), [save])

  if (error !== '') return <div className="oh-dsh-side-error" role="alert">{error}</div>
  if (content === null) return <div className="oh-dsh-side-muted">{t('overlay.loading')}</div>
  return (
    <div className="oh-dsh-editor-surface" data-testid="editor-surface">
      <div className="oh-dsh-editor-header">
        <span title={surface.filePath}>{surface.title}</span>
        {dirty ? <small className="oh-dsh-editor-dirty">●</small> : null}
        <span className="oh-dsh-editor-actions">
          <button type="button" onClick={() => { setReadOnly(value => !value) }}>
            {readOnly ? 'Edit' : 'Read only'}
          </button>
          <button type="button" disabled={saving || !dirty} onClick={() => { save() }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </span>
      </div>
      <EditProvider createEditor={createPierreEditor}>
        <Virtualizer className="oh-dsh-editor-host">
          <PierreFile
            file={file}
            edit={!readOnly}
            editorOptions={editorOptions}
            options={{ disableFileHeader: true, theme }}
            {...(lineAnnotations.length > 0
              ? {
                  lineAnnotations,
                  renderAnnotation: (annotation: { metadata: DiffComment }) => (
                    <CommentBubble comment={annotation.metadata} />
                  ),
                }
              : {})}
          />
        </Virtualizer>
      </EditProvider>
    </div>
  )
}

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
  const [context, setContext] = useState(3)
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
  if (error !== '') return <div className="oh-dsh-side-error" role="alert">{error}</div>
  if (diff === null || document === null) {
    return <div className="oh-dsh-side-muted">{t('overlay.loading')}</div>
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
          <div className="oh-dsh-side-muted">{t('workspace.loading-diff')}</div>
        )}
      </div>
    )
  }
  if (document.lines.length > 120_000 || diff.length > 6_000_000) {
    return (
      <div className="oh-dsh-diff-surface">
        <DiffToolbar t={t} />
        <div className="oh-dsh-side-muted">Diff too large to render inline ({document.lines.length} lines).</div>
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
          disabled={expanding || context >= 200}
          onClick={() => {
            setExpanding(true)
            setContext(value => Math.min(200, value + 20))
            window.setTimeout(() => setExpanding(false), 1200)
          }}
        >
          {expanding ? t('workspace.loading-diff') : `Expand context (${context} → ${Math.min(200, context + 20)})`}
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
            placeholder="Line"
            value={commentLine}
            onChange={event => { setCommentLine(event.target.value) }}
          />
          <input
            type="text"
            placeholder="Comment"
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
          >Add</button>
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
        } catch {
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
      setRenderedKeys(new Set(allFiles.slice(0, 6).map(file => file.path)))
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'F7') return
      event.preventDefault()
      navigateChange(event.shiftKey ? -1 : 1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [navigateChange])

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
      20,
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

  if (error !== '') return <div className="oh-dsh-side-error" role="alert">{error}</div>
  if (files === null) {
    return <div className="oh-dsh-side-muted">{t('overlay.loading')}</div>
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
          {expanding.size > 0 ? <div className="oh-dsh-side-muted">{t('workspace.loading-diff')}</div> : null}
        </div>
      </div>
    </div>
  )
}

/* ---------- commit diff ---------- */

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
  if (error !== '') return <div className="oh-dsh-side-error" role="alert">{error}</div>
  if (files === null) {
    return <div className="oh-dsh-side-muted">{t('overlay.loading')}</div>
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
          {files.map(file => (
            <details key={`${file.oldPath ?? ''}:${file.path}`} open data-path={file.path}>
              <summary>
                <span title={file.path}>{file.path}</span>
                <small><b>+{file.additions}</b> −{file.deletions}</small>
              </summary>
              <div className="oh-dsh-commit-surface-lines">
                <DiffViewer document={reviewFileToDiffDocument(file)} theme={theme} t={t} virtualize={false} hideMeta />
              </div>
            </details>
          ))}
          {files.length === 0 && (
            <div className="oh-dsh-side-muted">{t('workspace.no-text-diff')}</div>
          )}
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
  if (error !== '') return <div className="oh-dsh-side-error" role="alert">{error}</div>
  if (diff === null || document === null) {
    return <div className="oh-dsh-side-muted">{t('overlay.loading')}</div>
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
  if (error !== '') return <div className="oh-dsh-side-error" role="alert">{error}</div>
  if (files === null) return <div className="oh-dsh-side-muted">{t('overlay.loading')}</div>
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
          {files.map(file => (
            <details key={`${file.oldPath ?? ''}:${file.path}`} open data-path={file.path}>
              <summary>
                <span title={file.path}>{file.path}</span>
                <small><b>+{file.additions}</b> −{file.deletions}</small>
              </summary>
              <div className="oh-dsh-commit-surface-lines">
                <DiffViewer document={reviewFileToDiffDocument(file)} theme={theme} t={t} virtualize={false} hideMeta />
              </div>
            </details>
          ))}
          {files.length === 0 && (
            <div className="oh-dsh-side-muted">{t('workspace.no-text-diff')}</div>
          )}
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
  if (error !== '') return <div className="oh-dsh-side-error" role="alert">{error}</div>
  if (diff === null || document === null) {
    return <div className="oh-dsh-side-muted">{t('overlay.loading')}</div>
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
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }, [absolutePath, surface.cwd, surface.filePath, surface.sessionId, surface.id, name])

  const file = useMemo<FileContents>(() => ({
    name,
    contents: content ?? '',
    cacheKey: `conflict:${surface.filePath}`,
  }), [content, name, surface.filePath])

  if (error !== '') return <div className="oh-dsh-side-error" role="alert">{error}</div>
  if (content === null) return <div className="oh-dsh-side-muted">{t('overlay.loading')}</div>
  return (
    <div className="oh-dsh-conflict-surface" data-testid="conflict-surface">
      <div className="oh-dsh-conflict-header">
        <span title={surface.filePath}>{name}</span>
        <small>Merge conflict</small>
        <span className="oh-dsh-conflict-actions">
          <button type="button" disabled={busy}>{busy ? 'Resolving…' : 'Resolve and stage'}</button>
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
                <button type="button" disabled={busy} onClick={() => { resolve('current') }}>Accept current</button>
                <button type="button" disabled={busy} onClick={() => { resolve('incoming') }}>Accept incoming</button>
                <button type="button" disabled={busy} onClick={() => { resolve('both') }}>Keep both</button>
              </div>
            )
          }}
        />
      </Virtualizer>
    </div>
  )
}

