/**
 * Exclusive-owner registry for the selection-action floating layers: the
 * conversation picker and the comment card must never be open at the same
 * time (the "两个弹出层能同时存在" report). Owners request exclusive
 * access before opening; a pending owner is notified via `onBlocked` so it
 * can drop its own layer.
 *
 * Module-level singleton: the picker (SelectedTextAction) and the comment
 * rails are separate components; this tiny store is the only shared state.
 */

type OwnerId = 'conv' | 'comment'

let currentOwner: OwnerId | null = null
let blockedHandler: ((owner: OwnerId) => void) | null = null

/** Register a callback that fires when this owner was blocked by the other. */
export function setOwnerBlockedHandler(handle: (owner: OwnerId) => void): () => void {
  blockedHandler = handle
  return () => {
    if (blockedHandler === handle) blockedHandler = null
  }
}

/**
 * Request exclusive use. Returns true when granted; false when the other
 * owner holds it (and that owner's blocked handler is notified).
 */
export function requestExclusive(owner: OwnerId): boolean {
  if (currentOwner === null || currentOwner === owner) {
    currentOwner = owner
    return true
  }
  blockedHandler?.(currentOwner)
  return false
}

/** Release the lock if owned by `owner`. */
export function releaseExclusive(owner: OwnerId): void {
  if (currentOwner === owner) currentOwner = null
}