/**
 * Unified workbench comment store (R1): one persisted batch for file-view
 * AND diff annotations (worktree scope), replacing the v1 line-only shape.
 *
 * Persistence moved from localStorage into the domain-backed `comments`
 * ui-chrome table (F1/F2/M7) — see `comments-migration` for the one-time
 * idempotent migration of the legacy v2/v1/review keys. The workbench
 * comments live in the table's `workbench` array (`kind: 'workbench'`);
 * review comments share the same table under `review`.
 *
 * The zustand store is the single live mirror — surfaces subscribe instead
 * of keeping local copies, and every mutation writes through.
 */
import { create } from 'zustand'
import type { SidebarCommentsChrome } from '@dsh-studio/shared/ui-chrome-tables'
import {
  adoptCommentsRecord,
  commentsStorage,
  readCommentsRecord,
} from '@dsh-studio/shared/comments-record'
import { persistVia } from '@dsh-studio/shared/store-persistence'

export interface WorkbenchComment {
  id: string
  /** Absolute path (Electron surface) or git-relative (diff surface). */
  path: string
  /** 1-based anchor line — the range start. */
  startLine: number
  /** Range end when the comment spans multiple lines (defaults to start). */
  endLine?: number
  /** Anchor-line content hash ⇒ drift/outdated detection. */
  contentHash?: string
  /** Branch stamp on write; legacy null stays visible across branches. */
  branch?: string | null
  body: string
  createdAt: string
  /** Resolution timestamp; resolved comments stay listed but are excluded
   *  from new "add to conversation" payloads. */
  resolvedAt?: string
}

const MAX_COMMENTS = 200

interface WorkbenchCommentState {
  comments: readonly WorkbenchComment[]
  /** The single write path: surfaces never persist directly. */
  addComment(comment: WorkbenchComment): void
  removeComment(id: string): void
  /** Mark resolved (kept + listed, excluded from new payloads). */
  resolveComment(id: string): void
  /** Re-open a resolved comment. */
  unresolveComment(id: string): void
}

/** Live mirror of the persisted workbench comments; surfaces subscribe. */
export const useDiffCommentsStore = create<WorkbenchCommentState>((set, get) => ({
  comments: [],
  addComment: comment => {
    const next = [...get().comments, comment].slice(-MAX_COMMENTS)
    set({ comments: next })
  },
  removeComment: id => {
    const next = get().comments.filter(comment => comment.id !== id)
    set({ comments: next })
  },
  resolveComment: id => {
    const next = get().comments.map(comment =>
      comment.id === id && comment.resolvedAt === undefined
        ? { ...comment, resolvedAt: new Date().toISOString() }
        : comment,
    )
    if (next !== get().comments) {
      set({ comments: next })
    }
  },
  unresolveComment: id => {
    const next = get().comments.map(comment => {
      if (comment.id !== id || comment.resolvedAt === undefined) return comment
      const reopened = { ...comment }
      delete reopened.resolvedAt
      return reopened
    })
    if (next !== get().comments) {
      set({ comments: next })
    }
  },
}))

/**
 * Start the shared template-C persistence facade for the workbench half of
 * the comments table, aligned with the R1-restored domain persistence used
 * by the sidebar service. The facade owns the subscribe→load→merge→apply
 * race (changed-before-hydrate union) and the teardown flush that this
 * module previously hand-rolled. Returns a disposer for the plugin
 * lifecycle.
 */
export function startDiffCommentsPersistence(): () => void {
  return persistVia<SidebarCommentsChrome>(
    {
      subscribe: listener => useDiffCommentsStore.subscribe(listener),
      snapshot: () => ({
        // The review half rides on the shared owner's freshest cache so this
        // whole-record save can never erase newer review rows.
        review: readCommentsRecord().review,
        workbench: [...useDiffCommentsStore.getState().comments],
      }),
      apply: record => {
        adoptCommentsRecord(record)
        useDiffCommentsStore.setState({ comments: record.workbench ?? [] })
      },
    },
    {
      backend: commentsStorage,
      merge: (stored, current) => {
        // changed-before-hydrate: keep concurrent identity changes, then
        // append the persisted workbench rows that do not collide.
        const fromDomain = stored.workbench ?? []
        const currentComments = current.workbench ?? []
        return {
          ...stored,
          workbench: [
            ...currentComments,
            ...fromDomain.filter(c => !currentComments.some(x => x.id === c.id)),
          ].slice(-MAX_COMMENTS),
        }
      },
    },
  ).stop
}

/** Strip the workspace root prefix so git-relative and absolute paths compare. */
export function pathRelativeToCwd(filePath: string, cwd: string): string {
  const prefix = cwd.endsWith('/') ? cwd : `${cwd}/`
  return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath
}

/**
 * Whether a stored comment path (git-relative, from the diff surface) refers
 * to the same file as a surface's `filePath` (absolute in Electron). Both
 * sides are normalized against the workspace cwd before comparing.
 */
export function commentPathMatches(storedPath: string, filePath: string, cwd: string): boolean {
  return pathRelativeToCwd(storedPath, cwd) === pathRelativeToCwd(filePath, cwd)
}
