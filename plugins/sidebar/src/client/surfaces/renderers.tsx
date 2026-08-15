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
import { getFileRuntime } from '../runtimes/registry.ts'
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
import { buildDiffDocument } from '../diff/file-diff.ts'
import { usePierreDiffTheme } from '../diff/pierre-adapter.tsx'
import { parseGitReviewDiff, reviewFileToDiffDocument } from '../review/review-diff.ts'
import type { GitReviewFile } from '../review/review-types.ts'
import type {
  CommitCenterSurface,
  CommitFileCenterSurface,
  CommittedCenterSurface,
  DiffAllCenterSurface,
  DiffCenterSurface,
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
  const isImagePath = /\.(png|jpe?g|gif|webp|bmp|ico|svg|avif)$/i.test(surface.filePath)
  const theme = usePierreDiffTheme()
  const layout = useDiffViewPreferences(state => state.layout)
  const wordWrap = useDiffViewPreferences(state => state.wordWrap)

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
          layout={layout}
          wordWrap={wordWrap}
          hideMeta
          cacheBust={`${surface.staged ? 'staged' : 'unstaged'}:${context}`}
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
    void betterSidebarApi.gitDiff(
      { sessionId: surface.sessionId, cwd: surface.cwd },
      undefined,
      surface.staged,
    ).then(result => {
      if (!alive) return
      if (result.diff.trim() === '') {
        setError(t('workspace.no-text-diff'))
        return
      }
      const parsed = parseGitReviewDiff(result.diff)
      setFiles(parsed)
      setRenderedKeys(new Set(parsed.slice(0, 6).map(file => file.path)))
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
  const theme = usePierreDiffTheme()
  useEffect(() => {
    let alive = true
    setFiles(null)
    setError('')
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
      <div className="oh-dsh-commit-surface-body">
        {files.map(file => (
          <details key={`${file.oldPath ?? ''}:${file.path}`} open>
            <summary>
              <span title={file.path}>{file.path}</span>
              <small><b>+{file.additions}</b> −{file.deletions}</small>
            </summary>
            <div className="oh-dsh-commit-surface-lines">
              <DiffViewer document={reviewFileToDiffDocument(file)} theme={theme} rawOnly hideMeta />
            </div>
          </details>
        ))}
        {files.length === 0 && (
          <div className="oh-dsh-side-muted">{t('workspace.no-text-diff')}</div>
        )}
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
  const theme = usePierreDiffTheme()
  useEffect(() => {
    let alive = true
    setFiles(null)
    setError('')
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
  if (error !== '') return <div className="oh-dsh-side-error" role="alert">{error}</div>
  if (files === null) return <div className="oh-dsh-side-muted">{t('overlay.loading')}</div>
  return (
    <div className="oh-dsh-commit-surface">
      <div className="oh-dsh-commit-surface-header">
        <span>{surface.title}</span>
        <small>{surface.baseRef}</small>
      </div>
      <div className="oh-dsh-commit-surface-body">
        {files.map(file => (
          <details key={`${file.oldPath ?? ''}:${file.path}`} open>
            <summary>
              <span title={file.path}>{file.path}</span>
              <small><b>+{file.additions}</b> −{file.deletions}</small>
            </summary>
            <div className="oh-dsh-commit-surface-lines">
              <DiffViewer document={reviewFileToDiffDocument(file)} theme={theme} rawOnly hideMeta />
            </div>
          </details>
        ))}
        {files.length === 0 && (
          <div className="oh-dsh-side-muted">{t('workspace.no-text-diff')}</div>
        )}
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
          hideMeta
          cacheBust={`${surface.baseRef}:${filePath}`}
        />
      </div>
    </div>
  )
}

