/**
 * Promise-based confirm / prompt / alert. Presentation is the official
 * Modal + Button atoms plus the shared shadcn Input. Labels arrive
 * pre-translated from call sites.
 *
 * State convention (ADR, B7): single-request listener store where the
 * "slot" is a QUEUE — `open` appends a request and `close` shifts the head
 * and resolves it, so concurrent native dialogs never overwrite each other
 * and the earlier caller's Promise always settles (C3). If more than one
 * dialog stacks, the next one renders only after the current one closes.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { Input } from '@dsh-studio/shared/ui'

type DialogKind = 'confirm' | 'prompt' | 'alert'

interface DialogRequest {
  id: number
  kind: DialogKind
  title: string
  message?: string
  defaultValue?: string
  confirmLabel: string
  cancelLabel?: string
  danger: boolean
  resolve(value: boolean | string | null): void
}

let nextId = 1
let dialogQueue: DialogRequest[] = []
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The currently displayed request (queue head), or null when idle. */
function getSnapshot(): DialogRequest | null {
  return dialogQueue[0] ?? null
}

function open(next: DialogRequest): void {
  // Append rather than overwrite: a caller that fires while another dialog
  // is already up stays pending until its turn is shifted by close() and
  // resolved — it never hangs silently.
  dialogQueue.push(next)
  nextId += 1
  emit()
}

export interface ConfirmDialogOptions {
  title: string
  message?: string
  confirmLabel: string
  cancelLabel: string
  /** Danger styling for destructive actions. */
  danger?: boolean
}

export interface PromptDialogOptions {
  title: string
  message?: string
  defaultValue?: string
  confirmLabel: string
  cancelLabel: string
}

/** Confirmation dialog; resolves true only when confirmed. */
export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  return new Promise(resolve => {
    open({
      id: nextId,
      kind: 'confirm',
      ...options,
      danger: options.danger === true,
      resolve: value => { resolve(value === true) },
    })
  })
}

/** Single-input prompt; resolves the entered value or null on cancel. */
export function promptDialog(options: PromptDialogOptions): Promise<string | null> {
  return new Promise(resolve => {
    open({
      id: nextId,
      kind: 'prompt',
      ...options,
      danger: false,
      resolve: value => { resolve(typeof value === 'string' ? value : null) },
    })
  })
}

/** Error/info notice with a single OK button. */
export function alertDialog(options: {
  title: string
  message?: string
  confirmLabel: string
}): Promise<void> {
  return new Promise(resolve => {
    open({
      id: nextId,
      kind: 'alert',
      ...options,
      danger: false,
      resolve: () => { resolve() },
    })
  })
}

function close(value: boolean | string | null): void {
  // Shift the head and resolve it (if any), then emit so any stacked request
  // becomes the new head. Resolving the shifted head settles the originating
  // Promise instead of leaving it pending forever.
  const current = dialogQueue.shift()
  current?.resolve(value)
  emit()
}

/** Mount once next to the toast host; renders nothing while idle. */
export function DialogHost(): JSX.Element | null {
  const current = useSyncExternalStore(subscribe, getSnapshot)
  const [draft, setDraft] = useState('')
  const promptId = current?.kind === 'prompt' ? current.id : 0
  const promptDefault = current?.kind === 'prompt' ? (current.defaultValue ?? '') : ''
  useEffect(() => {
    if (promptId !== 0) setDraft(promptDefault)
  }, [promptId, promptDefault])
  if (current === null) return null
  const isPrompt = current.kind === 'prompt'
  return (
    <Modal
      open
      onClose={() => { close(null) }}
      title={current.title}
      closeLabel={current.cancelLabel ?? current.confirmLabel}
      {...(current.message === undefined || current.message === ''
        ? {}
        : { description: current.message })}
      footer={(
        <>
          {current.kind !== 'alert' ? (
            <Button variant="outline" size="sm" onClick={() => { close(null) }}>
              {current.cancelLabel ?? ''}
            </Button>
          ) : null}
          <Button
            variant="primary"
            size="sm"
            autoFocus={!isPrompt}
            onClick={() => {
              close(isPrompt ? draft : true)
            }}
          >
            {current.confirmLabel}
          </Button>
        </>
      )}
    >
      {isPrompt ? (
        <Input
          autoFocus
          defaultValue={current.defaultValue ?? ''}
          onChange={event => { setDraft(event.currentTarget.value) }}
          onKeyDown={event => {
            if (event.key === 'Enter') close(event.currentTarget.value)
          }}
        />
      ) : null}
    </Modal>
  )
}
