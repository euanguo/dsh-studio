/**
 * Wrap any observable snapshot source as a slots store whose state is a
 * projected `pick(source.getSnapshot())` (F6). Introduced to replace the
 * hand-rolled settings mirror (`defineStore` + a field-by-field `sync`
 * action + a `syncSidebarSettings` helper): the adapter declares only the
 * store shape and a pure `pick` function.
 *
 * The engine invokes the store's `sync` action with an immer `draft` as its
 * first argument, so callers only pass the freshly picked `next` state. The
 * plugin wires the source subscription (sidebar publish → `sync(pick(...))`)
 * once the framework has bound the store's actions to the slot injector.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

export interface ObservableSnapshot<S> {
  subscribe(listener: () => void): () => void
  getSnapshot(): S
}

export type DerivedStoreState<T> = EngineStoreHandle<T, { sync(draft: T, next: T): void }>

export function snapshotStoreAdapter<S, T>(
  source: ObservableSnapshot<S>,
  pick: (snapshot: S) => T,
): DerivedStoreState<T> {
  return defineStore({
    init: (): T => pick(source.getSnapshot()),
    actions: {
      sync: (draft, next) => {
        // Spread into a record face so the generic `T` (unconstrained here)
        // is copyable regardless of shape.
        Object.assign(draft as object, next as object)
      },
    },
  })
}