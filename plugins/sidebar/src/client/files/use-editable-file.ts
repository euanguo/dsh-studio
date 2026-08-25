/**
 * The file edit state machine, shared by the file surface's viewing and
 * editing states (plan A: in-place edit — no separate editor surface).
 *
 * Data flow:
 * - viewing state reads through the WorkspaceFileRuntime cache (truncated
 *   previews allowed);
 * - entering edit loads the FULL file through the same file runtime (the
 *   Edit affordance only exists when the cached snapshot is text and
 *   untruncated, so the runtime entry IS the complete content — one read
 *   path, no bare fsRead);
 * - every change updates the local copy, marks dirty and arms a 1s
 *   autosave;
 * - writes serialize through one queue (autosave / Mod+S / Save button can
 *   fire concurrently) and only clear dirty when the file on disk matches
 *   the editor content at resolve time;
 * - a successful write calls `onPersisted` so the host can invalidate the
 *   runtime cache; leaving edit state flushes pending dirty content first
 *   and stays in edit state when that flush fails.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Translate } from '@dsh-studio/shared/i18n'
import { toast } from '@dsh-studio/shared/toast'
import { errorMessage } from '@dsh-studio/shared/errors'
import type { WorkspaceMessage } from '../i18n.ts'
import { sidebarApi } from '../sidebar-api.ts'
import type { WorkspaceFileRuntime } from '../runtimes/file-runtime.ts'
import { binding, registerKeymapAction } from '../kit/keymap.ts'

/** Autosave delay after the last edit (ms). */
const AUTOSAVE_DELAY_MS = 1000

export interface EditableFileController {
  /** Whether the surface renders the editor instead of the viewer. */
  editMode: boolean
  /** Full-file content backing the editor; null while loading. */
  content: string | null
  dirty: boolean
  saving: boolean
  /** Load/save error shown in the edit state (stays until retried). */
  error: string
  enterEdit(): void
  /** Leave edit state; pending dirty content is flushed first. */
  exitToView(): void
  save(nextContent?: string): Promise<boolean>
  /** Feed the editor's onChange (updates the copy, arms autosave). */
  handleChange(nextContent: string): void
}

export function useEditableFile(options: {
  cwd: string
  filePath: string
  /** The retained file runtime the surface already reads through. */
  runtime: WorkspaceFileRuntime
  t: Translate<WorkspaceMessage>
  /** Called after every successful write (invalidate caches, refresh UI). */
  onPersisted(): void
}): EditableFileController {
  const { cwd, filePath, runtime, t, onPersisted } = options
  const scope = useMemo(() => ({ cwd }), [cwd])
  const latestContentRef = useRef('')
  const autosaveTimerRef = useRef<number | null>(null)
  const writeQueueRef = useRef(Promise.resolve(true))
  const pendingWritesRef = useRef(0)
  const aliveRef = useRef(true)
  const [editMode, setEditMode] = useState(false)
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  // Full-file load for the edit state, through the file runtime cache. The
  // viewer only offers editing for text + untruncated snapshots, so the
  // ready entry is the complete content; a missing/error entry still maps
  // to the same error states.
  useEffect(() => {
    if (!editMode) return
    let alive = true
    setContent(null)
    setError('')
    setDirty(false)
    latestContentRef.current = ''
    void runtime.ensureLoaded(filePath).then(entry => {
      if (!alive) return
      if (entry.phase === 'error') {
        setError(entry.message ?? t('files.viewer.binary'))
        return
      }
      const snapshot = entry.phase === 'ready' ? entry.snapshot : null
      if (snapshot === null || snapshot.kind !== 'text' || snapshot.content === null) {
        setError(t('files.viewer.binary'))
        return
      }
      latestContentRef.current = snapshot.content
      setContent(snapshot.content)
    })
    return () => { alive = false }
  }, [editMode, runtime, filePath, t])

  const save = useCallback((nextContent?: string): Promise<boolean> => {
    const value = nextContent ?? latestContentRef.current
    pendingWritesRef.current += 1
    setSaving(true)
    const run = writeQueueRef.current
      .then(() => sidebarApi.fsWrite(scope, filePath, value))
      .then(() => {
        if (!aliveRef.current) return true
        // Typing during the write keeps the content ahead of the file —
        // only clear dirty when the file on disk matches what we hold.
        setDirty(latestContentRef.current !== value)
        setError('')
        onPersisted()
        return true
      })
      .catch((cause: unknown) => {
        const message = errorMessage(cause)
        if (aliveRef.current) {
          setError(message)
          toast(t('toast.save-failed', { message }))
        }
        return false
      })
      .finally(() => {
        pendingWritesRef.current -= 1
        if (pendingWritesRef.current === 0) setSaving(false)
      })
    writeQueueRef.current = run
    return run
  }, [scope, filePath, t, onPersisted])

  const handleChange = useCallback((nextContent: string) => {
    latestContentRef.current = nextContent
    setDirty(true)
    if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = window.setTimeout(() => {
      void save(nextContent)
    }, AUTOSAVE_DELAY_MS)
  }, [save])

  const disarmAutosave = useCallback((): void => {
    // Cancel a pending autosave timer (1s after the last edit) so it cannot
    // fire after we leave the edit state / flush manually (C19: exit leaves a
    // stale timer still writing to disk once more).
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
  }, [])

  const enterEdit = useCallback(() => {
    setEditMode(true)
  }, [])

  const exitToView = useCallback(() => {
    disarmAutosave()
    if (!dirty) {
      setEditMode(false)
      return
    }
    // Flush pending dirty content before switching back to the viewer; a
    // failed flush keeps the editor open so no unsaved content is lost.
    void save().then(ok => {
      if (ok && aliveRef.current) setEditMode(false)
    })
  }, [disarmAutosave, dirty, save])

  // Mod+S flushes the editor immediately while editing (autosave is the
  // safety net); the viewer state leaves Mod+S to the host app.
  useEffect(() => {
    if (!editMode) return
    return registerKeymapAction('file.save', binding({ mod: true, key: 's' }), () => {
      void save()
      return true
    })
  }, [editMode, save])

  // Unmount clears timers; pending writes still settle in the queue.
  useEffect(() => () => {
    aliveRef.current = false
    disarmAutosave()
  }, [disarmAutosave])

  return { editMode, content, dirty, saving, error, enterEdit, exitToView, save, handleChange }
}
