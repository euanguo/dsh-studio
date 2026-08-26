/**
 * The file center surface: one component, two states (plan A — in-place
 * edit).
 *
 * - Viewing state renders through the file runtime cache (truncated
 *   previews allowed) with FileViewerChrome + ContentViewer (Pierre family).
 * - Editing state swaps the body in place for the Pierre editor (full-file
 *   content via useEditableFile); the SAME FileViewerChrome stays mounted
 *   (breadcrumb + meta), only its actions slot swaps to Save / View. The
 *   separate editor surface/tab no longer exists.
 *
 * Data flow:
 *   runtime cache (view) ──enterEdit──▶ full fsRead (edit copy)
 *   edit copy ──autosave/Save──▶ fs.write ──▶ runtime.invalidate ──▶ viewer
 *   re-reads the fresh file (other file tabs see the change too).
 */
import { SidebarSurfaceCss as surfaceCss } from '../styles.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EditorOptions } from '@pierre/diffs/edit'
import { Editor } from '@pierre/diffs/edit'
import { EditProvider, File as PierreFile, Virtualizer } from '@pierre/diffs/react'
import type { FileContents } from '@pierre/diffs'
import type { Translate } from '@dsh-studio/shared/i18n'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { toast } from '@dsh-studio/shared/toast'
import { basename } from '@dsh-studio/shared/path'
import type { WorkspaceMessage } from '../i18n.ts'
import { sidebarApi } from '../sidebar-api.ts'
import { getFileRuntime } from '../runtimes/registry.ts'
import { useCenterSurfaceStore } from './center-surface-store.ts'
import { binding, registerKeymapAction } from '../kit/keymap.ts'
import { ScrollArea } from '@dsh-studio/shared/ui'
import { ErrorState, LoadingState } from '@dsh-studio/shared/ui'
import { errorMessage } from '@dsh-studio/shared/errors'
import { ContentViewer } from '../files/content-viewer.tsx'
import { FileViewerChrome, type MarkdownViewMode } from '../files/file-viewer-chrome.tsx'
import type { SessionsService } from '../client-types.ts'
import { toggleMarkdownTaskMarker } from '../files/markdown-task-list.ts'
import { useEditableFile } from '../files/use-editable-file.ts'
import { usePierreDiffTheme } from '../diff/pierre-adapter.tsx'
import { useDiffCommentsStore, commentBelongsToCwd, commentPathMatches, type WorkbenchComment } from '../diff/diff-comments-store.ts'
import { commentsToFileLineAnnotations } from '../diff/comment-annotations.ts'
import { CommentBubble } from '../diff/comment-bubble.tsx'
import { buildCommentReference } from '../comments/comment-rails-core.ts'
import { insertReferenceIntoConversation } from '../selection/conversation-targets.ts'
import { formatSelectionLabel } from '../selection/selection-reference.ts'
import { commentAnchorOf, useSelectionActionOverlay } from '../selection/use-selection-action.tsx'
import { useCommentRails } from '../comments/comment-rails.tsx'
import type { FileCenterSurface } from './types.ts'

function createPierreEditor<LAnnotation>(options: EditorOptions<LAnnotation>): Editor<LAnnotation> {
  return new Editor(options)
}

export function FileSurfaceView({
  surface,
  t,
  sessions,
}: {
  surface: FileCenterSurface
  t: Translate<WorkspaceMessage>
  /** Session roster for the selection action bar's target dropdown. */
  sessions?: SessionsService | null
}): JSX.Element {
  const runtime = useMemo(
    () => getFileRuntime({ cwd: surface.cwd }),
    [surface.cwd],
  )
  const [fingerprint, setFingerprint] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [writeError, setWriteError] = useState('')
  const theme = usePierreDiffTheme()
  // Editor-state selection host (the editor host element, bound below).
  const editorHostRef = useRef<HTMLDivElement | null>(null)

  const onPersisted = useCallback(() => {
    runtime.invalidate(surface.filePath)
    setFingerprint(runtime.fingerprint())
    void runtime.ensureLoaded(surface.filePath).then(() => {
      setFingerprint(runtime.fingerprint())
    })
  }, [runtime, surface.filePath])

  const editable = useEditableFile({
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
    layer: typeof document === 'undefined' ? null : document.body,
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
            const snapshot = sessions.list.getSnapshot()
            const target = snapshot.current ?? Object.keys(snapshot.byId)[0]
            if (target === undefined) return 'unavailable'
            // Insert as an inline reference chip (styled block), not raw
            // text — same as the selection action bar's add-to-chat.
            return insertReferenceIntoConversation(sessions, target, {
              label: formatSelectionLabel({
                path: input.path,
                span: { startLine: input.line, endLine: input.line },
              }),
              clipboardText: buildCommentReference(input.path, input.line, input.body),
            })
          },
        }),
  })

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
        { cwd: surface.cwd },
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
        const message = errorMessage(cause)
        setWriteError(message)
        toast(t('toast.save-failed', { message }))
      })
  }, [runtime, surface.cwd, surface.filePath, t])

  const onOpenExternal = useCallback(() => {
    if (window.dshDesktop !== undefined) {
      void window.dshDesktop.openExternal(surface.filePath)
    }
  }, [surface.filePath])

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

  const editorOptions = useMemo<EditorOptions<WorkbenchComment>>(() => ({
    persistState: false,
    onChange: nextFile => {
      editable.handleChange(nextFile.contents)
    },
  }), [editable.handleChange])

  const lineAnnotations = useMemo(
    () => commentsToFileLineAnnotations(comments),
    [comments],
  )

  // Editor-state selection action bar (the Pierre editor is selectable
  // text too). Lives in the drawer region so the listeners are shared.
  const editSelectionAction = useSelectionActionOverlay({
    containerRef: editorHostRef,
    path: surface.filePath,
    cwd: surface.cwd,
    content: editable.content,
    layer: typeof document === 'undefined' ? null : document.body,
    sessions: sessions ?? null,
    onComment: anchor => {
      rails.composeAt(commentAnchorOf(anchor))
    },
    t,
  })

  /* ---------- editing state ---------- */

  if (editable.editMode) {
    if (editable.error !== '') return <ErrorState message={editable.error} />
    if (editable.content === null) return <LoadingState label={t('overlay.loading')} />
    return (
      <div className={surfaceCss["dsh-studio-editor-surface"]} data-testid="editor-surface">
        <FileViewerChrome
          cwd={surface.cwd}
          filePath={surface.filePath}
          isMarkdown={isMarkdown}
          markdownMode={markdownMode}
          onMarkdownModeChange={onMarkdownModeChange}
          editing={{
            dirty: editable.dirty,
            onExit: editable.exitToView,
          }}
          t={t}
        />
        <EditProvider createEditor={createPierreEditor}>
          <div ref={editorHostRef} className={`dsh-studio-editor-host-wrap`}>
            <Virtualizer className={surfaceCss["dsh-studio-editor-host"]}>
              {rails.overlay()}
              {editSelectionAction.overlay}
              <PierreFile
              file={file}
              edit
              editorOptions={editorOptions}
              options={{
                disableFileHeader: true,
                theme,
                onLineEnter: rails.onLineEnter,
                onLineLeave: rails.onLineLeave,
              }}
              renderGutterUtility={rails.gutterUtility}
              {...(lineAnnotations.length > 0
                ? {
                    lineAnnotations,
                    renderAnnotation: (annotation: { metadata: WorkbenchComment }) => (
                      <CommentBubble comment={annotation.metadata} t={t} />
                    ),
                  }
                : {})}
              />
            </Virtualizer>
          </div>
        </EditProvider>
      </div>
    )
  }

  /* ---------- viewing state ---------- */

  const entry = runtime.getEntry(surface.filePath)
  if (entry === undefined || entry.phase === 'loading') {
    return <LoadingState label={t('overlay.loading')} />
  }
  if (entry.phase === 'error' || entry.snapshot === null) {
    return (
      <ErrorState
        message={entry.message ?? t('overlay.no-content')}
        action={(
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              runtime.invalidate(surface.filePath)
              setReloadKey(value => value + 1)
            }}
          >
            {t('overlay.retry')}
          </Button>
        )}
      />
    )
  }
  const snapshot = entry.snapshot
  const content = snapshot.kind === 'text' ? snapshot.content : null
  // Editing works on the full file: truncated previews and non-text
  // snapshots keep the Edit affordance hidden.
  const canEdit = content !== null && !snapshot.truncated
  return (
    <div className={surfaceCss["dsh-studio-file-surface"]} data-testid="file-surface">
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
        <ErrorState message={writeError} />
      ) : null}
      <ScrollArea className={surfaceCss["dsh-studio-file-surface-body"]}>
        {rails.overlay()}
        <ContentViewer
          path={surface.filePath}
          content={content}
          binary={snapshot.binary}
          size={snapshot.size}
          truncated={snapshot.truncated}
          markdownPreview={markdownMode === 'preview'}
          comments={comments}
          cwd={surface.cwd}
          rails={rails}
          sessions={sessions ?? null}
          onTaskToggle={onTaskToggle}
          onOpenExternal={onOpenExternal}
          {...(snapshot.data === undefined ? {} : { data: snapshot.data })}
          hideMeta
          t={t}
        />
      </ScrollArea>
    </div>
  )
}
