/**
 * Lightweight app-wide toast (plan P9.2). A tiny external store drives a
 * single mounted ToastHost; `toast()` is callable from anywhere (handlers,
 * services) without React context plumbing. Entries auto-dismiss and stack
 * bottom-center. One host per app — the sidebar plugin mounts it.
 *
 * The store lives on globalThis instead of a module-level binding: every
 * plugin bundles its own copy of plugins/shared modules, so module state
 * would silently fork per bundle and toasts published from one plugin would
 * never reach another plugin's host.
 */
import { useSyncExternalStore } from 'react'

export type ToastKind = 'success' | 'error'

export interface ToastEntry {
  id: number
  kind: ToastKind
  message: string
}

interface ToastStore {
  nextId: number
  entries: readonly ToastEntry[]
  listeners: Set<() => void>
}

const STORE_KEY = '__ohDshToastStore'

function getStore(): ToastStore {
  const global = globalThis as { [STORE_KEY]?: ToastStore }
  let store = global[STORE_KEY]
  if (store === undefined) {
    store = { nextId: 1, entries: [], listeners: new Set() }
    global[STORE_KEY] = store
  }
  return store
}

function publish(next: readonly ToastEntry[]): void {
  const store = getStore()
  store.entries = next
  for (const listener of store.listeners) listener()
}

const TOAST_DISMISS_MS = 2400

/** Show a transient toast; returns immediately. */
export function toast(kind: ToastKind, message: string): void {
  const store = getStore()
  const id = store.nextId
  store.nextId += 1
  publish([...store.entries, { id, kind, message }])
  window.setTimeout(() => {
    publish(getStore().entries.filter(entry => entry.id !== id))
  }, TOAST_DISMISS_MS)
}

function subscribe(listener: () => void): () => void {
  const store = getStore()
  store.listeners.add(listener)
  return () => { store.listeners.delete(listener) }
}

function getSnapshot(): readonly ToastEntry[] {
  return getStore().entries
}

/** Mount once (the sidebar plugin root); renders nothing while idle. */
export function ToastHost(): JSX.Element | null {
  const list = useSyncExternalStore(subscribe, getSnapshot)
  if (list.length === 0) return null
  return (
    <div className="oh-dsh-toast-host" role="status" aria-live="polite">
      {list.map(entry => (
        <div key={entry.id} className="oh-dsh-toast" data-kind={entry.kind}>
          {entry.message}
        </div>
      ))}
    </div>
  )
}
