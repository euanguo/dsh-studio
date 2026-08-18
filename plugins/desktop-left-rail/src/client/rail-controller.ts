import type { WorktreeLayoutResult, WorktreeRemovalPreview } from './worktree-api.ts'

export interface PhysicalWorktreePort {
  preview(repoRoot: string, path: string): Promise<WorktreeRemovalPreview>
  remove(repoRoot: string, path: string, force: boolean): Promise<WorktreeLayoutResult>
  refresh(): void
}

export interface RailController {
  previewPhysicalWorktree(repoRoot: string, path: string): Promise<WorktreeRemovalPreview>
  removePhysicalWorktree(repoRoot: string, path: string, force: boolean): Promise<WorktreeLayoutResult>
}

/**
 * Coordinates topology-changing actions behind one small seam. Operations for
 * the same canonical path share a promise; independent worktrees may proceed
 * concurrently without letting one stale completion refresh another target.
 */
export function createRailController(port: PhysicalWorktreePort): RailController {
  const inFlight = new Map<string, Promise<unknown>>()
  const keyOf = (repoRoot: string, path: string): string => `${repoRoot}\0${path}`
  const enqueue = <T>(key: string, operation: () => Promise<T>): Promise<T> => {
    const previous = inFlight.get(key) ?? Promise.resolve()
    const next = previous.then(operation, operation)
    inFlight.set(key, next)
    void next.then(
      () => { if (inFlight.get(key) === next) inFlight.delete(key) },
      () => { if (inFlight.get(key) === next) inFlight.delete(key) },
    )
    return next
  }
  return {
    previewPhysicalWorktree: (repoRoot, path) => enqueue(keyOf(repoRoot, path), () => port.preview(repoRoot, path)),
    removePhysicalWorktree: (repoRoot, path, force) => enqueue(keyOf(repoRoot, path), async () => {
      const result = await port.remove(repoRoot, path, force)
      port.refresh()
      return result
    }),
  }
}
