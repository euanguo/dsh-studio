/**
 * Pure merge-conflict resolution over raw marker content.
 *
 * Mirrors @pierre/diffs' `rebuildUnresolvedFile` /
 * `getResolvedConflictReplacementLines` (components/UnresolvedFile.js).
 * The react UnresolvedFile wrapper hydrates fileDiff/actions but NOT the
 * original `file`, so `instance.resolveConflict(...).file.contents` comes
 * back empty — we therefore rebuild the resolved content ourselves from the
 * source string plus the conflict region the library parsed (same
 * `splitFileContents` semantics: split with a capture group so newlines
 * stay attached to their lines).
 */
import type { MergeConflictRegion, MergeConflictResolution } from '@pierre/diffs'

/** Same split semantics as the library: split AFTER each \n (lines keep their
 *  trailing newline; \r stays attached for CRLF files). */
const SPLIT_WITH_NEWLINES = /(?<=\n)/

function splitFileContents(contents: string): string[] {
  return contents !== '' ? contents.split(SPLIT_WITH_NEWLINES) : []
}

/** Resolved file contents for one conflict region and resolution. */
export function resolveConflictRegionContents(
  contents: string,
  region: Pick<MergeConflictRegion, 'startLineIndex' | 'separatorLineIndex' | 'endLineIndex' | 'baseMarkerLineIndex'>,
  resolution: MergeConflictResolution,
): string {
  const lines = splitFileContents(contents)
  const currentLines = lines.slice(region.startLineIndex + 1, region.baseMarkerLineIndex ?? region.separatorLineIndex)
  const incomingLines = lines.slice(region.separatorLineIndex + 1, region.endLineIndex)
  const replacement = resolution === 'current'
    ? currentLines
    : resolution === 'incoming'
      ? incomingLines
      : [...currentLines, ...incomingLines]
  return [
    ...lines.slice(0, region.startLineIndex),
    ...replacement,
    ...lines.slice(region.endLineIndex + 1),
  ].join('')
}
