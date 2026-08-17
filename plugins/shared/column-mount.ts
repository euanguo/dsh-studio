/**
 * Self-healing mounts into the DSH conversation column.
 *
 * Both the terminal dock (panel-controls) and the bottom workbench (sidebar)
 * live in the conversation column (`[data-phase]`'s parent), which DSH
 * renders asynchronously and may replace wholesale.  This module provides
 * the shared column-finding, scheduler, and observer pattern so both
 * plugins use the same self-healing machinery.
 */

/** The conversation column every bottom-panel plugs into. */
export function findConversationColumn(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-phase]')?.parentElement ?? null
}

/** A coalescing rAF scheduler — many `schedule()` calls yield one `run`. */
export function createMountScheduler(run: () => void): {
  schedule(): void
  cancel(): void
} {
  let frame: number | null = null
  return {
    schedule: () => {
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        run()
      })
    },
    cancel: () => {
      if (frame === null) return
      cancelAnimationFrame(frame)
      frame = null
    },
  }
}

/** Returns true when a mutation record affects the page outside the
 *  owned-root subtree, so the owner's mount observer does not loop on its
 *  own DOM writes. */
export function mutationNeedsMount(
  record: MutationRecord,
  ownedRoot: string,
): boolean {
  if (record.type === 'attributes') return !insideOwnedRoot(record.target, ownedRoot)
  if (record.type !== 'childList' || insideOwnedRoot(record.target, ownedRoot)) return false
  return [...record.addedNodes, ...record.removedNodes]
    .some(node => !insideOwnedRoot(node, ownedRoot))
}

function insideOwnedRoot(node: Node, ownedRoot: string): boolean {
  let current: Node | null = node
  // `!= null` also stops at a stub parentNode that is undefined (the unit
  // tests build plain object graphs without real DOM nodes).
  while (current != null) {
    // nodeType === 1 (Element) + a `matches` function, instead of
    // `instanceof Element`, so the module stays importable in non-DOM
    // environments (unit tests run under node:test without jsdom).
    if (current.nodeType === 1
      && typeof (current as Element).matches === 'function'
      && (current as Element).matches(ownedRoot)) {
      return true
    }
    current = current.parentNode
  }
  return false
}