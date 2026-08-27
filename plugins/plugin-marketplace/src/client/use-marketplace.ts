/**
 * use-marketplace.ts (leaf-4.2 / C35)
 * ---------------------------------------------------------------------
 * View-side data + command wiring for the marketplace modal. It reuses the
 * leaf-3.2 zustand store entirely (snapshot / busy / localError / requestId /
 * host push) — no state is re-created here, this hook only connects the React
 * surface to that store and exposes a typed `run`.
 *
 * C35 (single first-screen roundtrip): the old boot called
 * `refreshMarketplace`, which did `getSnapshot()` then `dispatch(refresh)` —
 * two host roundtrips. Here the mount effect issues ONE
 * `dispatch({ type: 'refresh' })`, whose resolved snapshot already reflects
 * the live catalog, so the first paint needs a single host roundtrip.
 * (requestId stale-guard still applies inside the store dispatch.)
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { DesktopBridge } from '@dsh-studio/shared/desktop-contracts'
import type {
  MarketplaceCommand,
  MarketplaceSnapshot,
} from '../protocol.ts'
import {
  runMarketplaceCommand,
  subscribeMarketplaceHost,
  type MarketplaceDispatchOutcome,
  type MarketplaceStore,
} from './store.ts'

export interface MarketplaceData {
  snapshot: MarketplaceSnapshot | null
  busy: boolean
  localError: string | null
}

/** Connect the surface to the marketplace store and run handler. */
export function useMarketplaceData(
  bridge: DesktopBridge,
  store: MarketplaceStore,
): { data: MarketplaceData; run: (command: MarketplaceCommand) => Promise<MarketplaceDispatchOutcome> } {
  const snapshot = useSyncExternalStore(store.subscribe, () => store.getState().snapshot)
  const busy = useSyncExternalStore(store.subscribe, () => store.getState().busy)
  const localError = useSyncExternalStore(store.subscribe, () => store.getState().localError)

  const run = useCallback(
    (command: MarketplaceCommand): Promise<MarketplaceDispatchOutcome> =>
      runMarketplaceCommand(bridge, store, command),
    [bridge, store],
  )
  const hydrated = useRef(false)

  // Initial load + host change-push subscription (D4/D17). Single roundtrip.
  // React StrictMode replays effects in development; the store instance still
  // owns one initial refresh so the host mutex never sees a duplicate request.
  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true
      void runMarketplaceCommand(bridge, store, { type: 'refresh' })
    }
    return subscribeMarketplaceHost(bridge, store)
  }, [bridge, store])

  return { data: { snapshot, busy, localError }, run }
}