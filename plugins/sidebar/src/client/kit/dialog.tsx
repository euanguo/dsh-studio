/**
 * Styled app dialogs (confirm / prompt / alert) replacing window.confirm /
 * prompt / alert. A tiny module store drives a single DialogHost mounted by
 * the plugin root; the promise-based helpers are callable from anywhere.
 * All labels arrive pre-translated from call sites (like kit/status.tsx).
 */
import { useRef, useSyncExternalStore } from 'react'

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
  const inputRef = useRef<HTMLInputElement | null>(null)
  if (current === null) return null
  const isPrompt = current.kind === 'prompt'
  return (
    <div
      className="oh-dsh-dialog-backdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget) close(null)
      }}
    >
      <div
        className="oh-dsh-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={current.title}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            close(null)
          } else if (event.key === 'Enter' && !isPrompt) {
            event.stopPropagation()
            close(true)
          }
        }}
      >
        <div className="oh-dsh-dialog-title">{current.title}</div>
        {current.message !== undefined && current.message !== '' ? (
          <div className="oh-dsh-dialog-message">{current.message}</div>
        ) : null}
        {isPrompt ? (
          <input
            ref={inputRef}
            className="oh-dsh-dialog-input"
            autoFocus
            defaultValue={current.defaultValue ?? ''}
            onKeyDown={event => {
              if (event.key === 'Enter') close(event.currentTarget.value)
            }}
          />
        ) : null}
        <div className="oh-dsh-dialog-actions">
          {current.kind !== 'alert' ? (
            <button
              type="button"
              className="oh-dsh-dialog-cancel"
              onClick={() => { close(null) }}
            >
              {current.cancelLabel ?? ''}
            </button>
          ) : null}
          <button
            type="button"
            autoFocus={!isPrompt}
            className={`oh-dsh-dialog-confirm${current.danger ? ' is-danger' : ''}`}
            onClick={() => {
              close(isPrompt ? (inputRef.current?.value ?? '') : true)
            }}
          >
            {current.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
