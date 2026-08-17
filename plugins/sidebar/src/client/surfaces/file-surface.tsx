/**
 * The file center surface: one component, two states (plan A — in-place
 * edit).
 *
 * - Viewing state renders through the file runtime cache (truncated
 *   previews allowed) with FileViewerChrome + ContentViewer (Pierre family).
 * - Editing state swaps the body in place for the Pierre editor (full-file
 *   content via useEditableFile) and the editor header; Save writes back,
 *   "View" flushes pending changes and returns to the viewer. The separate
 *   editor surface/tab no longer exists.
 *
 * Data flow:
 *   runtime cache (view) ──enterEdit──▶ full fsRead (edit copy)
 *   edit copy ──autosave/Save──▶ fs.write ──▶ runtime.invalidate ──▶ viewer
 *   re-reads the fresh file (other file tabs see the change too).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EditorOptions } from '@pierre/diffs/edit'
import { Editor } from '@pierre/diffs/edit'
import { EditProvider, File as PierreFile, Virtualizer } from '@pierre/diffs/react'
import type { FileContents } from '@pierre/diffs'
import type { Translate } from '@oh-dsh/shared/i18n'
import { Button, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { basename } from '@oh-dsh/shared/path'
import { toast } from '@oh-dsh/shared/toast'
import type { WorkspaceMessage } from '../i18n.ts'
import { sidebarApi } from '../sidebar-api.ts'
import { getFileRuntime } from '../runtimes/registry.ts'
import { useCenterSurfaceStore } from './center-surface-store.ts'
import { binding, registerKeymapAction } from '../kit/keymap.ts'
import { Scrollable } from '@oh-dsh/shared/scrollable'
import { ErrorView, LoadingView } from '../kit/status.tsx'
import { ContentViewer } from '../files/content-viewer.tsx'
import { FileViewerChrome, type MarkdownViewMode } from '../files/file-viewer-chrome.tsx'
import type { ReviewCommentsService } from '../review/review-comments.ts'
import { toggleMarkdownTaskMarker } from '../files/markdown-task-list.ts'
import { afterSelectionCommit, formatFileSelectionReference, getLineSelectionWithin } from '../files/file-selection-reference.ts'
import { useEditableFile } from '../files/use-editable-file.ts'
import { usePierreDiffTheme } from '../diff/pierre-adapter.tsx'
import { useDiffCommentsStore, commentPathMatches, type DiffComment } from '../diff/diff-comments-store.ts'
import { commentsToFileLineAnnotations } from '../diff/comment-annotations.ts'
import { CommentBubble } from '../diff/comment-bubble.tsx'
import type { FileCenterSurface } from './types.ts'

function createPierreEditor<LAnnotation>(options: EditorOptions<LAnnotation>): Editor<LAnnotation> {
  return new Editor(options)
}

export function FileSurfaceView({
  surface,
  t,
  reviewComments,
}: {
  surface: FileCenterSurface
  t: Translate<WorkspaceMessage>
  /** Selection → "add to conversation" channel (wired by builtins). */
  reviewComments?: ReviewCommentsService
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
  const theme = usePierreDiffTheme()

  const onPersisted = useCallback(() => {
    runtime.invalidate(surface.filePath)
    setFingerprint(runtime.fingerprint())
    void runtime.ensureLoaded(surface.filePath).then(() => {
      setFingerprint(runtime.fingerprint())
    })
  }, [runtime, surface.filePath])

  const editable = useEditableFile({
    sessionId: surface.sessionId,
    cwd: surface.cwd,
    filePath: surface.filePath,
    runtime,
    t,
    onPersisted,
  })

  // Persisted diff comments hang on the file's own lines in both states
  // (one comment system across diff / file / editor views); the store is
  // the single live source (M5).
  const allComments = useDiffCommentsStore(state => state.comments)
  const comments = useMemo(
    () => allComments.filter(comment =>
      commentPathMatches(comment.filePath, surface.filePath, surface.cwd)
      && comment.createdAt.length > 0,
    ),
    [allComments, surface.cwd, surface.filePath],
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

  // Mod+Shift+V toggles Source/Preview on markdown file surfaces, only in
  // the viewing state (the edit state renders the source editor).
  useEffect(() => {
    if (!isMarkdown || editable.editMode) return
    return registerKeymapAction(
      'markdown.togglePreview',
      binding({ mod: true, shift: true, key: 'v' }),
      () => {
        onMarkdownModeChange(markdownMode === 'preview' ? 'source' : 'preview')
        return true
      },
    )
  }, [isMarkdown, editable.editMode, markdownMode, onMarkdownModeChange])

  // Markdown task toggling is a viewing-state affordance that writes the
  // file; its own queue avoids racing the editor's (never concurrent).
  const writeQueueRef = useRef(Promise.resolve())
  const onTaskToggle = useCallback(({ sourceLine, checked }: { sourceLine: number; checked: boolean }) => {
    const entry = runtime.getEntry(surface.filePath)
    const snapshot = entry?.phase === 'ready' ? entry.snapshot : null
    if (snapshot === null || snapshot.kind !== 'text' || snapshot.content === null || snapshot.truncated) return
    const next = toggleMarkdownTaskMarker(snapshot.content, sourceLine, checked)
    if (next === null) return
    setWriteError('')
    writeQueueRef.current = writeQueueRef.current
      .then(() => sidebarApi.fsWrite(
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
        const message = cause instanceof Error ? cause.message : String(cause)
        setWriteError(message)
        toast(t('toast.save-failed', { message }))
      })
  }, [runtime, surface.cwd, surface.filePath, surface.sessionId, t])

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
    const { clientX, clientY, currentTarget } = event
    // The selection is not committed while mouseup runs (shadow-tree rows
    // commit in the following rendering step) — read it once committed.
    afterSelectionCommit(() => {
      const selection = getLineSelectionWithin(currentTarget)
      if (selection === null) {
        setSelectionAction(null)
        return
      }
      setSelectionAction({
        left: clientX,
        top: clientY,
        label: formatFileSelectionReference({ path: surface.filePath, selection }),
      })
    })
  }, [isMarkdown, markdownMode, surface.filePath])

  const onCopySelection = useCallback(async (label: string) => {
    const ok = await writeClipboard(label)
    toast(ok ? t('toast.copied') : t('toast.copy-failed'))
    setSelectionAction(null)
  }, [t])

  // All hooks run before the state branches below (React hook order).
  const lineCount = useMemo(
    () => {
      const snapshot = runtime.getEntry(surface.filePath)?.snapshot
      const content = snapshot?.kind === 'text' ? snapshot.content : null
      return content === null ? 0 : content.split('\n').length
    },
    // `runtime` and `surface.filePath` are stable across the surface's
    // lifetime, so the memo would otherwise never recompute after the
    // snapshot loads (and stay at 0). `fingerprint` changes whenever the
    // runtime cache entry mutates (load / invalidate / persist), so it is
    // the correct trigger for recalculating the derived line count.
    [runtime, surface.filePath, fingerprint],
  )

  const file = useMemo<FileContents>(() => ({
    name: basename(surface.filePath),
    contents: editable.content ?? '',
    cacheKey: `editor:${surface.filePath}`,
  }), [editable.content, surface.filePath])

  const editorOptions = useMemo<EditorOptions<DiffComment>>(() => ({
    persistState: false,
    onChange: nextFile => {
      editable.handleChange(nextFile.contents)
    },
  }), [editable.handleChange])

  const lineAnnotations = useMemo(
    () => commentsToFileLineAnnotations(comments),
    [comments],
  )

  /* ---------- editing state ---------- */

  if (editable.editMode) {
    if (editable.error !== '') return <ErrorView message={editable.error} />
    if (editable.content === null) return <LoadingView label={t('overlay.loading')} />
    return (
      <div className="oh-dsh-editor-surface" data-testid="editor-surface">
        <div className="oh-dsh-editor-header">
          <span title={surface.filePath}>{surface.title}</span>
          {editable.dirty ? <small className="oh-dsh-editor-dirty">●</small> : null}
          <span className="oh-dsh-editor-actions">
            <Button
              variant="primary"
              size="sm"
              disabled={editable.saving || !editable.dirty}
              onClick={() => { void editable.save() }}
            >
              {editable.saving ? t('file.saving') : t('file.save')}
            </Button>
            <Button variant="outline" size="sm" onClick={editable.exitToView}>
              {t('files.view')}
            </Button>
          </span>
        </div>
        <EditProvider createEditor={createPierreEditor}>
          <Virtualizer className="oh-dsh-editor-host">
            <PierreFile
              file={file}
              edit
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

  /* ---------- viewing state ---------- */

  const entry = runtime.getEntry(surface.filePath)
  if (entry === undefined || entry.phase === 'loading') {
    return <LoadingView label={t('overlay.loading')} />
  }
  if (entry.phase === 'error' || entry.snapshot === null) {
    return (
      <ErrorView
        message={entry.message ?? t('overlay.no-content')}
        retryLabel={t('overlay.retry')}
        onRetry={() => {
          runtime.invalidate(surface.filePath)
          setReloadKey(value => value + 1)
        }}
      />
    )
  }
  const snapshot = entry.snapshot
  const content = snapshot.kind === 'text' ? snapshot.content : null
  // Editing works on the full file: truncated previews and non-text
  // snapshots keep the Edit affordance hidden.
  const canEdit = content !== null && !snapshot.truncated
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
        t={t}
        {...(canEdit ? { onEdit: editable.enterEdit } : {})}
      />
      {writeError !== '' ? (
        <ErrorView message={writeError} />
      ) : null}
      <Scrollable className="oh-dsh-file-surface-body" onMouseUp={onSourceMouseUp}>
        <ContentViewer
          path={surface.filePath}
          content={content}
          binary={snapshot.binary}
          size={snapshot.size}
          truncated={snapshot.truncated}
          markdownPreview={markdownMode === 'preview'}
          comments={comments}
          cwd={surface.cwd}
          {...(reviewComments === undefined ? {} : { reviewComments })}
          onTaskToggle={onTaskToggle}
          onOpenExternal={onOpenExternal}
          {...(snapshot.data === undefined ? {} : { data: snapshot.data })}
          hideMeta
          t={t}
        />
      </Scrollable>
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
