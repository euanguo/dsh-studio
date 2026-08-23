/**
 * Pure mapping from persisted diff comments to Pierre line annotations.
 *
 * One comment model feeds three surfaces: the FileDiff annotations hang on
 * the diff's "additions" (new) side at the comment's new-side line number;
 * File components (viewer + editor) take plain LineAnnotations at the same
 * line number. `renderAnnotation` on each component then draws the bubble.
 */
import type { DiffLineAnnotation, LineAnnotation } from '@pierre/diffs'
import type { WorkbenchComment } from './diff-comments-store.ts'

/** The diff side a comment annotation renders on (new side = file line). */
export const COMMENT_ANNOTATION_SIDE = 'additions' as const

/** Comments → FileDiff annotations (new-side lines). */
export function commentsToDiffLineAnnotations(
  comments: readonly WorkbenchComment[],
): Array<DiffLineAnnotation<WorkbenchComment>> {
  return comments.map(comment => ({
    side: COMMENT_ANNOTATION_SIDE,
    lineNumber: comment.startLine,
    metadata: comment,
  }))
}

/** Comments → File annotations (viewer / editor). */
export function commentsToFileLineAnnotations(
  comments: readonly WorkbenchComment[],
): Array<LineAnnotation<WorkbenchComment>> {
  return comments.map(comment => ({
    lineNumber: comment.startLine,
    metadata: comment,
  }))
}
