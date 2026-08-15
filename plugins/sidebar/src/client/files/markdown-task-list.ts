/**
 * Pure GFM task-list marker flip for rendered markdown preview writes.
 * `sourceLine` is 1-based, matching the source markdown line index.
 * Ported from Synara `entities/markdown-task-list.ts`.
 */
const TASK_MARKER_PATTERN = /^((?:\s*>)*\s*(?:[-*+]|\d+[.)])\s+\[)[ xX](\])/

export function toggleMarkdownTaskMarker(
  contents: string,
  sourceLine: number,
  checked: boolean,
): string | null {
  const lines = contents.split('\n')
  const index = sourceLine - 1
  const line = lines[index]
  if (line === undefined) return null
  const match = TASK_MARKER_PATTERN.exec(line)
  if (match === null) return null
  lines[index] = `${match[1]}${checked ? 'x' : ' '}${match[2]}${line.slice(match[0].length)}`
  return lines.join('\n')
}

/**
 * Map a rendered GFM task-list checkbox index (0-based, in render order) to
 * its 1-based source line. We cannot use the hast node position (the
 * remark-rehype bridge drops mdast positions), so we recover the mapping by
 * scanning the source for task-marker lines in order — deterministic for the
 * same GFM constructs react-markdown + remark-gfm render.
 */
export function findTaskMarkerSourceLines(contents: string): number[] {
  const result: number[] = []
  const lines = contents.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    if (TASK_MARKER_PATTERN.test(line)) result.push(index + 1)
  }
  return result
}
