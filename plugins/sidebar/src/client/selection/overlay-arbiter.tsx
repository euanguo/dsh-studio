/**
 * Exclusive-owner registry for the selection-action floating layers: the
 * conversation picker and the comment card must never be open at the same
 * time (the "两个弹出层能同时存在" report). Owners request exclusive
 * access before opening; a pending owner is notified via `onBlocked` so it
 * can drop its own layer.
 *
 * Instances are created per-surface with {@link createOverlayArbiter}, so
 * independent panels never lock each other across surfaces (C16). The
 * arbiter is handed to each consumer through {@link OverlayArbiterContext}
 * rather than a module-level shared single instance: the selection action
 * bar (conversation picker) and the comment rails on a given surface read
 * the SAME surface-level instance from context so comment and picker stay
 * mutually exclusive (C2), while other surfaces get their own instance and
 * can never deadlock one another (C16). Before the context migration these
 * were module-level named exports backed by one shared instance; those are
 * gone.
 */

import { createContext, useContext, type ReactNode } from 'react'

type OwnerId = 'conv' | 'comment'

export interface OverlayArbiter {
  /**
   * Register a callback that fires when `owner` was blocked by the other
   * surface's owner. Returns an unregister function.
   */
  setOwnerBlockedHandler(handle: (owner: OwnerId) => void): () => void
  /**
   * Request exclusive use. Returns true when granted; false when the other
   * owner holds it (and that owner's blocked handler is notified).
   */
  requestExclusive(owner: OwnerId): boolean
  /** Release the lock if owned by `owner`. */
  releaseExclusive(owner: OwnerId): void
}

/** Create a fresh, per-surface exclusive-owner registry. */
export function createOverlayArbiter(): OverlayArbiter {
  let currentOwner: OwnerId | null = null
  let blockedHandler: ((owner: OwnerId) => void) | null = null

  return {
    setOwnerBlockedHandler(handle: (owner: OwnerId) => void): () => void {
      blockedHandler = handle
      return () => {
        if (blockedHandler === handle) blockedHandler = null
      }
    },
    requestExclusive(owner: OwnerId): boolean {
      if (currentOwner === null || currentOwner === owner) {
        currentOwner = owner
        return true
      }
      blockedHandler?.(currentOwner)
      return false
    },
    releaseExclusive(owner: OwnerId): void {
      if (currentOwner === owner) currentOwner = null
    },
  }
}

/**
 * React context distributing a per-surface arbiter to every layer consumer
 * (conversation picker + comment rails) on that surface (C16). Mount exactly
 * one provider per surface and consume via {@link useOverlayArbiter}.
 */
export const OverlayArbiterContext = createContext<OverlayArbiter | null>(null)

/**
 * Provide `arbiter` to the layer consumers in the subtree (C16). A surface
 * host mounts this with its own {@link createOverlayArbiter} instance.
 */
export function OverlayArbiterProvider({
  arbiter,
  children,
}: {
  readonly arbiter: OverlayArbiter
  readonly children: ReactNode
}): JSX.Element {
  return (
    <OverlayArbiterContext.Provider value={arbiter}>
      {children}
    </OverlayArbiterContext.Provider>
  )
}

/**
 * Read the current surface's overlay arbiter from context (C16). Throws when
 * called outside an {@link OverlayArbiterProvider} — a surface using either
 * the conversation picker or the comment rails must host the arbiter.
 */
export function useOverlayArbiter(): OverlayArbiter {
  const arbiter = useContext(OverlayArbiterContext)
  if (arbiter === null) {
    throw new Error('useOverlayArbiter used outside OverlayArbiterProvider')
  }
  return arbiter
}