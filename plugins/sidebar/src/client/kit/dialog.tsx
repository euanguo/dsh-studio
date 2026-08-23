/**
 * Promise-based confirm / prompt / alert. Presentation is the official
 * Modal + Button + Input atoms. Labels arrive pre-translated from call sites.
 *
 * State convention (ADR, B7): single-request listener store — see
 * plugins/shared/toast.tsx for the shared rationale; heavier stores use
 * zustand or the official client-runtime defineStore.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'

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
let request: DialogRequest | null = null
const listeners = new Set<() => void>()

function publish(next: DialogRequest | null): void {
  request = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function getSnapshot(): DialogRequest | null {
  return request
}

function open(next: DialogRequest): void {
  publish(next)
  nextId += 1
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
  const current = request
  publish(null)
  current?.resolve(value)
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
