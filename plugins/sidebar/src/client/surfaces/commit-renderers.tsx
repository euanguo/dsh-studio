/**
 * Center surface renderers for the COMMIT / COMMITTED review views:
 * whole-commit diff stacks (lazy-mounted blocks), single-file diffs
 * within a commit, and the committed-changes projection against the
 * branch upstream. Data comes from the retained diff runtime; tree
 * selection / collapsed directories are shared chrome.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Translate } from '@dsh-studio/shared/i18n'
import type { WorkspaceMessage } from '../i18n.ts'
import { getDiffRuntime, sidebarScopeKey } from '../runtimes/registry.ts'
import { useSidebarChromeStore } from '../runtimes/chrome-store.ts'
import {
  commitDocKey,
  commitListKey,
  committedDocKey,
  committedListKey,
} from '../runtimes/diff-runtime.ts'
import { EmptyState, ErrorState, LoadingState } from '@dsh-studio/shared/ui'
import { DiffViewer } from '../diff/diff-viewer.tsx'
import { DiffPathTreeNav } from '../diff/path-tree-nav.tsx'
import { ScrollArea, SurfaceToolbar } from '@dsh-studio/shared/ui'
import { buildDiffTreeRows } from '../diff/diff-path-tree.ts'
import { usePierreDiffTheme, type PierreDiffTheme } from '../diff/pierre-adapter.tsx'
import { useLazyDiffBlockMount } from '../diff/use-lazy-diff-block-mount.ts'
import { useSelectionActionOverlay } from '../selection/use-selection-action.tsx'
import type { SessionsService } from '../client-types.ts'
import { reviewFileToDiffDocument, type GitReviewFile } from '../diff/git-review-diff.ts'
import { buildDiffDocument } from '../diff/file-diff.ts'
import type {
  CommitCenterSurface,
  CommitFileCenterSurface,
  CommittedCenterSurface,
} from './types.ts'

/* ---------- commit diff ---------- */

/**
 * One commit file's details/summary row. The details stay open, but the
 * heavy DiffViewer body mounts lazily via useLazyDiffBlockMount (M7) and
 * releases to a same-height placeholder when the row scrolls far away.
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
  const { mounted, releasedHeight, detailsRef, bodyRef } = useLazyDiffBlockMount()
  const document = useMemo(() => reviewFileToDiffDocument(file), [file])
  return (
    <details ref={detailsRef} open data-path={file.path}>
      <summary>
        <span title={file.path}>{file.path}</span>
        <small><b>+{file.additions}</b> −{file.deletions}</small>
      </summary>
      <ScrollArea className="dsh-studio-commit-surface-lines" viewportClassName="dsh-studio-ui-scroll-viewport-inset" ref={bodyRef}>
        {releasedHeight !== null ? (
          <div
            className="dsh-studio-commit-released"
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
      </ScrollArea>
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
        <EmptyState title={t('workspace.no-text-diff')} />
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
    () => getDiffRuntime({ cwd: surface.cwd }),
    [surface.cwd],
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
  const scopeKey = sidebarScopeKey({ cwd: surface.cwd })
  const chrome = useSidebarChromeStore(state => state.getSlice(scopeKey))
  const selectedPath = chrome.sourceControl.selectedPath
  const collapsedDirs = useMemo(
    () => new Set(chrome.sourceControl.collapsedDirectories),
    [chrome.sourceControl.collapsedDirectories],
  )
  const rows = useMemo(() => buildDiffTreeRows(files ?? [], selectedPath, collapsedDirs), [files, selectedPath, collapsedDirs])
  if (list !== undefined && list.phase === 'error') {
    return <ErrorState message={list.message ?? t('overlay.no-content')} />
  }
  if (files === null) {
    return <LoadingState label={t('overlay.loading')} />
  }
  return (
    <div className="dsh-studio-commit-surface">
      <SurfaceToolbar
        leading={<span title={surface.hash}>{surface.title}</span>}
        meta={<small>{surface.hash.slice(0, 7)}</small>}
      />
      <div className="dsh-studio-commit-tree-body">
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
        <ScrollArea className="dsh-studio-commit-surface-body" ref={bodyRef}>
          <CommitFileStack
            files={files}
            theme={theme}
            t={t}
            cacheBust={`commit:${surface.hash}`}
          />
        </ScrollArea>
      </div>
    </div>
  )
}

/* ---------- commit-file diff (single file within a commit) ---------- */

export function CommitFileSurfaceView({
  surface,
  t,
  sessions,
}: {
  surface: CommitFileCenterSurface
  t: Translate<WorkspaceMessage>
  sessions?: SessionsService
}): JSX.Element {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const theme = usePierreDiffTheme()
  const selectionAction = useSelectionActionOverlay({
    containerRef: bodyRef,
    path: surface.filePath,
    cwd: surface.cwd,
    layer: typeof window === 'undefined' ? null : window.document.body,
    sessions: sessions ?? null,
    t,
  })
  const runtime = useMemo(
    () => getDiffRuntime({ cwd: surface.cwd }),
    [surface.cwd],
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
    return <ErrorState message={doc.message ?? t('overlay.no-content')} />
  }
  if (doc === undefined || doc.phase === 'loading' || diff === null || document === null) {
    return <LoadingState label={t('overlay.loading')} />
  }
  if (diff.trim() === '') {
    return <ErrorState message={t('workspace.no-text-diff')} />
  }
  return (
    <div className="dsh-studio-diff-surface">
      <SurfaceToolbar
        leading={<span title={surface.filePath}>{surface.filePath}</span>}
        meta={<small>{surface.hash.slice(0, 7)}</small>}
      />
      <ScrollArea className="dsh-studio-diff-surface-body" ref={bodyRef}>
        {selectionAction.overlay}
        <DiffViewer
          document={document}
          theme={theme}
          t={t}
          hideMeta
          cacheBust={`${surface.hash}:${surface.filePath}`}
        />
      </ScrollArea>
    </div>
  )
}

/* ---------- committed-changes diff (against branch upstream) ---------- */

export function CommittedSurfaceView({
  surface,
  t,
  sessions,
}: {
  surface: CommittedCenterSurface
  t: Translate<WorkspaceMessage>
  sessions?: SessionsService
}): JSX.Element {
  if (surface.filePath !== undefined) {
    return <CommittedFileDiffView surface={surface} t={t} {...(sessions === undefined ? {} : { sessions })} />
  }
  return <CommittedAllDiffView surface={surface} t={t} />
}

function CommittedAllDiffView({
  surface,
  t,
}: {
  surface: CommittedCenterSurface
  t: Translate<WorkspaceMessage>
  sessions?: SessionsService
}): JSX.Element {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const theme = usePierreDiffTheme()

  // Committed file list lives in the diff runtime; tree chrome is shared.
  const runtime = useMemo(
    () => getDiffRuntime({ cwd: surface.cwd }),
    [surface.cwd],
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
  const scopeKey = sidebarScopeKey({ cwd: surface.cwd })
  const chrome = useSidebarChromeStore(state => state.getSlice(scopeKey))
  const selectedPath = chrome.sourceControl.selectedPath
  const collapsedDirs = useMemo(
    () => new Set(chrome.sourceControl.collapsedDirectories),
    [chrome.sourceControl.collapsedDirectories],
  )
  const rows = useMemo(() => buildDiffTreeRows(files ?? [], selectedPath, collapsedDirs), [files, selectedPath, collapsedDirs])
  if (list !== undefined && list.phase === 'error') {
    return <ErrorState message={list.message ?? t('overlay.no-content')} />
  }
  if (files === null) return <LoadingState label={t('overlay.loading')} />
  return (
    <div className="dsh-studio-commit-surface">
      <SurfaceToolbar
        leading={<span>{surface.title}</span>}
        meta={<small>{surface.baseRef}</small>}
      />
      <div className="dsh-studio-commit-tree-body">
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
        <ScrollArea className="dsh-studio-commit-surface-body" ref={bodyRef}>
          <CommitFileStack
            files={files}
            theme={theme}
            t={t}
            cacheBust={`committed:${surface.baseRef}`}
          />
        </ScrollArea>
      </div>
    </div>
  )
}

function CommittedFileDiffView({
  surface,
  t,
  sessions,
}: {
  surface: CommittedCenterSurface
  t: Translate<WorkspaceMessage>
  sessions?: SessionsService
}): JSX.Element {
  const filePath = surface.filePath ?? ''
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const theme = usePierreDiffTheme()
  const selectionAction = useSelectionActionOverlay({
    containerRef: bodyRef,
    path: filePath,
    cwd: surface.cwd,
    layer: typeof window === 'undefined' ? null : window.document.body,
    sessions: sessions ?? null,
    t,
  })
  const runtime = useMemo(
    () => getDiffRuntime({ cwd: surface.cwd }),
    [surface.cwd],
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
    return <ErrorState message={doc.message ?? t('overlay.no-content')} />
  }
  if (doc === undefined || doc.phase === 'loading' || diff === null || document === null) {
    return <LoadingState label={t('overlay.loading')} />
  }
  if (diff.trim() === '') {
    return <ErrorState message={t('workspace.no-text-diff')} />
  }
  return (
    <div className="dsh-studio-diff-surface">
      <SurfaceToolbar
        leading={<span title={filePath}>{filePath}</span>}
        meta={<small>{surface.baseRef}</small>}
      />
      <ScrollArea className="dsh-studio-diff-surface-body" ref={bodyRef}>
        {selectionAction.overlay}
        <DiffViewer
          document={document}
          theme={theme}
          t={t}
          hideMeta
          cacheBust={`${surface.baseRef}:${filePath}`}
        />
      </ScrollArea>
    </div>
  )
}
