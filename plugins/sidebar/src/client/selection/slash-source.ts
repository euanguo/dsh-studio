/**
 * The `dsh-studio-selection` slash source.
 *
 * The composer's `slash/input-insert-reference` channel only accepts
 * references whose source is REGISTERED (same as `dsh-studio-review`);
 * without registration the send fails with "slash no serializer for
 * reference source". The codec must map a `ref` back to the reference's
 * model text — occurrences only carry `{source, ref, label, clipboardText}`
 * at insert time, so this module keeps a module-level map from ref → payload
 * that the insertion path (`insertReferenceIntoConversation`) populates and
 * the codec reads at submit time.
 */
import type { ReviewSlashSource } from '../review/review-comments.ts'

export const SELECTION_SOURCE = 'dsh-studio-selection'
export const SELECTION_REF = 'selection-reference'

/** ref → model text to serialize at submit time. */
const payloadByRef = new Map<string, string>()

/** Record the model text for a reference so its codec can serialize it. */
export function recordSelectionReference(ref: string, modelText: string): void {
  payloadByRef.set(ref, modelText)
}

export function createSelectionSlashSource(): ReviewSlashSource {
  return {
    trigger: '@',
    name: SELECTION_SOURCE,
    order: 1000,
    candidates: async () => [],
    onPick: () => undefined,
    codec: {
      // The workspace interface's codec is parameterless (see
      // review-comments.ts ReviewSlashSource); it serializes the MOST
      // RECENT reference of this source — sufficient for the single
      // selection-chip-per-draft flow, matching the review bridge.
      clipboardText: () => payloadByRef.get(SELECTION_REF) ?? '',
      serialize: async () => payloadByRef.get(SELECTION_REF) ?? '',
    },
  }
}