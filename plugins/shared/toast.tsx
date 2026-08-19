/**
 * App-wide toast publisher. The sidebar plugin mounts `ToastHost`; other
 * plugins only call `toast()`. The store lives on globalThis because each
 * plugin bundles its own copy of this module.
 *
 * Presentation is the official `Toast` atom. There is no DSH Studio toast
 * surface and no success/error kind — pass the resolved copy.
 */
import { useSyncExternalStore } from 'react'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'

export interface ToastEntry {
  id: number
  text: string
}

interface ToastStore {
  nextId: number
  entry: ToastEntry | null
  listeners: Set<() => void>
}

const STORE_KEY = '__dshStudioToastStore'

function getStore(): ToastStore {
  const global = globalThis as { [STORE_KEY]?: ToastStore }
  let store = global[STORE_KEY]
  if (store === undefined) {
    store = { nextId: 1, entry: null, listeners: new Set() }
    global[STORE_KEY] = store
  }
  return store
}

function publish(entry: ToastEntry | null): void {
  const store = getStore()
  store.entry = entry
  for (const listener of store.listeners) listener()
}

/** Show a transient official toast; returns immediately. */
export function toast(text: string): void {
  const store = getStore()
  const id = store.nextId
  store.nextId += 1
  publish({ id, text })
}

function subscribe(listener: () => void): () => void {
  const store = getStore()
  store.listeners.add(listener)
  return () => { store.listeners.delete(listener) }
}

function getSnapshot(): ToastEntry | null {
  return getStore().entry
}

/** Mount once (the sidebar plugin root); renders nothing while idle. */
export function ToastHost(): JSX.Element | null {
  const entry = useSyncExternalStore(subscribe, getSnapshot)
  if (entry === null) return null
  return (
    <Toast
      key={entry.id}
      text={entry.text}
      onDone={() => {
        if (getStore().entry?.id === entry.id) publish(null)
      }}
    />
  )
}
