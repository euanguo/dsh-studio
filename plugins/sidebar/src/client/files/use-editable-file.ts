/**
 * The file edit state machine, shared by the file surface's viewing and
 * editing states (plan A: in-place edit — no separate editor surface).
 *
 * Data flow:
 * - viewing state reads through the WorkspaceFileRuntime cache (truncated
 *   previews allowed);
 * - entering edit loads the FULL file through the sidebar fs API into a
 *   local content copy;
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
import type { Translate } from '../../../../shared/i18n.ts'
import { toast } from '../../../../shared/toast.tsx'
import type { WorkspaceMessage } from '../i18n.ts'
import { betterSidebarApi } from '../better-sidebar-api.ts'
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
  sessionId: string
  cwd: string
  filePath: string
  t: Translate<WorkspaceMessage>
  /** Called after every successful write (invalidate caches, refresh UI). */
  onPersisted(): void
}): EditableFileController {
  const { sessionId, cwd, filePath, t, onPersisted } = options
  const scope = useMemo(() => ({ sessionId, cwd }), [sessionId, cwd])
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

  // Full-file load for the edit state (the runtime cache may hold a
  // truncated preview — editing always works on the complete content).
  useEffect(() => {
    if (!editMode) return
    let alive = true
    setContent(null)
    setError('')
    setDirty(false)
    latestContentRef.current = ''
    void betterSidebarApi.fsRead(scope, filePath).then(result => {
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
    return () => { alive = false }
  }, [editMode, scope, filePath, t])

  const save = useCallback((nextContent?: string): Promise<boolean> => {
    const value = nextContent ?? latestContentRef.current
    pendingWritesRef.current += 1
    setSaving(true)
    const run = writeQueueRef.current
      .then(() => betterSidebarApi.fsWrite(scope, filePath, value))
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
        const message = cause instanceof Error ? cause.message : String(cause)
        if (aliveRef.current) {
          setError(message)
          toast('error', t('toast.save-failed', { message }))
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

  const enterEdit = useCallback(() => {
    setEditMode(true)
  }, [])

  const exitToView = useCallback(() => {
    if (!dirty) {
      setEditMode(false)
      return
    }
    // Flush pending dirty content before switching back to the viewer; a
    // failed flush keeps the editor open so no unsaved content is lost.
    void save().then(ok => {
      if (ok && aliveRef.current) setEditMode(false)
    })
  }, [dirty, save])

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
    if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current)
  }, [])

  return { editMode, content, dirty, saving, error, enterEdit, exitToView, save, handleChange }
}
