/**
 * Marketplace store (leaf-3.2 / D4 / D17): a zustand store that owns the
 * mutable Marketplace seen across the modal — the snapshot, the busy flag,
 * the latest-request stale-guard and an in-flight error surface.
 *
 * Request consistency (D17): every command/dispatch bumps a monotonically
 * increasing `requestId`; responses are applied only when their request id is
 * still the latest, so a "refresh then quick undo" can never let an out-of
 * order response clobber a newer state.
 *
 * Host change pushes (D4): the main process emits
 * `desktop:plugin-marketplace-changed` whenever the transaction state
 * transitions (e.g. a deferred agent apply/undo lands). The store subscribes
 * to `onSnapshotChanged` and re-pulls, so an open modal is never stale.
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type { DesktopBridge } from '@dsh-studio/shared/desktop-contracts'
import { errorMessage } from '@dsh-studio/shared/errors'
import type {
  MarketplaceCommand,
  MarketplaceSnapshot,
} from '../protocol.ts'

/** A dispatch that was rejected because the host is already busy (D4). */
export interface MarketplaceBusyRejection {
  kind: 'busy'
  message: string
}

export interface MarketplaceDispatchOutcome {
  snapshot: MarketplaceSnapshot | null
  rejected: MarketplaceBusyRejection | null
}

interface MarketplaceStoreState {
  /** Latest accepted snapshot (null until the first read). */
  snapshot: MarketplaceSnapshot | null
  /** True while any command is in flight (drives spinner + button disable). */
  busy: boolean
  /** Monotonic request stamp; only the latest response is applied (D17). */
  requestId: number
  /** Locally-failed command message (distinct from host snapshot.error). */
  localError: string | null
}

interface MarketplaceStoreActions {
  /** Apply a fresh snapshot only if it is still the latest request (D17). */
  accept(requestId: number, snapshot: MarketplaceSnapshot): void
  setBusy(busy: boolean): void
  setLocalError(message: string | null): void
}

/** A POSTED dispatch returns either the accepted snapshot or a busy
 *  rejection — never a silent drop (D4). */
/** The zustand store handle: the bound hook plus the store API
 *  (`getState` / `setState` / `subscribe`). */
export type MarketplaceStore = UseBoundStore<StoreApi<MarketplaceStoreState & MarketplaceStoreActions>>

/** A POSTED dispatch returns either the accepted snapshot or a busy
 *  rejection — never a silent drop (D4). */
export function createMarketplaceStore(): MarketplaceStore {
  return create<MarketplaceStoreState & MarketplaceStoreActions>(set => ({
    snapshot: null,
    busy: false,
    requestId: 0,
    localError: null,
    accept: (requestId, snapshot) => {
      set(current => (requestId === current.requestId ? { snapshot } : current))
    },
    setBusy: busy => set({ busy }),
    setLocalError: message => set({ localError: message }),
  }))
}

/**
 * Run one marketplace command over the bridge, applying the stale-guard.
 * Returns the accepted snapshot (or null when the host rejected a busy
 * command — D4 typed rejection instead of a silent drop).
 */
export async function runMarketplaceCommand(
  bridge: DesktopBridge,
  store: MarketplaceStore,
  command: MarketplaceCommand,
): Promise<MarketplaceDispatchOutcome> {
  const requestId = store.getState().requestId + 1
  store.setState({ requestId, busy: true, localError: null })
  try {
    const next = await bridge.pluginMarketplace.dispatch(command) as MarketplaceSnapshot
    if (store.getState().requestId === requestId) {
      store.getState().accept(requestId, next)
    }
    return { snapshot: next, rejected: null }
  } catch (error) {
    if (store.getState().requestId !== requestId) {
      // A newer command superseded this one; do not surface a stale error.
      return { snapshot: store.getState().snapshot, rejected: null }
    }
    // The host throws a typed busy rejection (D4) which arrives here as a
    // generic Error. Surface it through localError so the modal shows a
    // "busy" notice instead of silently dropping the command.
    const message = errorMessage(error)
    store.getState().setLocalError(message)
    return {
      snapshot: store.getState().snapshot,
      rejected: { kind: 'busy', message },
    }
  } finally {
    if (store.getState().requestId === requestId) {
      store.getState().setBusy(false)
    }
  }
}

/** Pull the host snapshot then dispatch a refresh, applying the guard. */
export async function refreshMarketplace(
  bridge: DesktopBridge,
  store: MarketplaceStore,
  force = false,
): Promise<void> {
  const requestId = store.getState().requestId + 1
  store.setState({ requestId, busy: true, localError: null })
  try {
    const initial = await bridge.pluginMarketplace.getSnapshot() as MarketplaceSnapshot
    if (store.getState().requestId === requestId) store.getState().accept(requestId, initial)
    const refreshed = await bridge.pluginMarketplace.dispatch(
      force ? { type: 'refresh', force: true } : { type: 'refresh' },
    ) as MarketplaceSnapshot
    if (store.getState().requestId === requestId) store.getState().accept(requestId, refreshed)
  } catch (error) {
    if (store.getState().requestId === requestId) {
      store.getState().setLocalError(errorMessage(error))
    }
  } finally {
    if (store.getState().requestId === requestId) store.getState().setBusy(false)
  }
}

/**
 * Subscribe to host change pushes and re-pull the snapshot (D4). Returns an
 * unsubscribe function. Call once when the marketplace mounts. These are
 * background notifications (e.g. a deferred agent apply landing), so they do
 * NOT force the busy spinner — a fresh snapshot just replaces the old one.
 */
export function subscribeMarketplaceHost(
  bridge: DesktopBridge,
  store: MarketplaceStore,
): () => void {
  let alive = true
  const unsubscribe = bridge.pluginMarketplace.onSnapshotChanged(() => {
    if (!alive) return
    const requestId = store.getState().requestId + 1
    store.setState({ requestId })
    void bridge.pluginMarketplace
      .getSnapshot()
      .then(snapshot => {
        if (alive && store.getState().requestId === requestId) {
          store.getState().accept(requestId, snapshot as MarketplaceSnapshot)
        }
      })
  })
  return () => { alive = false; unsubscribe() }
}