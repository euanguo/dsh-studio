/**
 * Single owner of the durable `comments` ui-chrome record. The table stores
 * ONE whole document with two halves (workbench line comments + git-review
 * comments); two independent writer modules used to hold their own stale
 * copy of the other half and erase each other's rows on every save. Every
 * read/write now funnels through this module's cache, so a half-update
 * always rides on the freshest known other-half.
 */
import { createUiChromeStorage } from './ui-chrome-storage.ts'
import {
  defaultSidebarCommentsChrome,
  sanitizeSidebarComments,
  UI_CHROME_TABLES,
  type PersistedReviewComment,
  type PersistedWorkbenchComment,
  type SidebarCommentsChrome,
} from './ui-chrome-tables.ts'

export const commentsStorage = createUiChromeStorage<SidebarCommentsChrome>({
  table: UI_CHROME_TABLES.comments,
  defaults: defaultSidebarCommentsChrome,
  sanitize: sanitizeSidebarComments,
})

let record: SidebarCommentsChrome | undefined

function clone(value: SidebarCommentsChrome): SidebarCommentsChrome {
  return {
    workbench: [...value.workbench],
    review: [...value.review],
  }
}

/**
 * Load the full record once per session (subsequent reads hit the cache).
 * Throws when the domain is unreachable so callers never mistake "down" for
 * "empty" and write defaults over intact host data.
 */
export async function loadCommentsRecord(): Promise<SidebarCommentsChrome> {
  if (record !== undefined) return clone(record)
  const value = await commentsStorage.load()
  if (commentsStorage.availability() === 'unavailable') {
    throw new Error('comments table is unreachable')
  }
  record = value
  return clone(value)
}

/** The freshest known record (defaults before the first successful load). */
export function readCommentsRecord(): SidebarCommentsChrome {
  return clone(record ?? defaultSidebarCommentsChrome())
}

/** Adopt a full record obtained outside the normal load path (hydration). */
export function adoptCommentsRecord(value: SidebarCommentsChrome): void {
  record = clone(value)
}

/** Replace the workbench half, preserving the freshest review half. */
export async function putWorkbenchComments(
  workbench: readonly PersistedWorkbenchComment[],
): Promise<void> {
  await loadCommentsRecord()
  const next = { ...readCommentsRecord(), workbench: [...workbench] }
  record = next
  commentsStorage.save(clone(next))
}

/** Replace the review half, preserving the freshest workbench half. */
export async function putReviewComments(
  review: readonly PersistedReviewComment[],
): Promise<void> {
  await loadCommentsRecord()
  const next = { ...readCommentsRecord(), review: [...review] }
  record = next
  commentsStorage.save(clone(next))
}
