/**
 * Diff document entity (ported from the reference project's
 * `entities/file-diff.ts`): the unified structured model every diff view
 * consumes. Raw git diff text → DiffDocument (lines + stats), then rendered
 * through the single DiffViewer.
 */

export type DiffLineKind = 'context' | 'added' | 'removed' | 'hunk'

export type DiffLayoutStyle = 'unified' | 'split'
export type DiffFileChangeKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'unchanged'

export type DiffLine = Readonly<{
  kind: DiffLineKind
  text: string
  displayText: string
  oldLine: number | null
  newLine: number | null
  oldLineLabel: string
  newLineLabel: string
}>

export type DiffDocument = Readonly<{
  path: string
  change: DiffFileChangeKind
  additions: number
  deletions: number
  lines: ReadonlyArray<DiffLine>
}>

export interface DiffDocumentInput {
  path: string
  change: DiffFileChangeKind
  additions: number
  deletions: number
  patch: string
}

/** Build a DiffDocument from a raw unified diff patch (stats counted from the patch). */
export function buildDiffDocument(input: DiffDocumentInput): DiffDocument {
  const lines = parsePatchLines(input.patch)
  const counted = countLineStats(lines)
  const hasPatchStats = counted.additions > 0 || counted.deletions > 0 || lines.length > 0
  return {
    path: input.path,
    change: input.change,
    additions: hasPatchStats ? counted.additions : input.additions,
    deletions: hasPatchStats ? counted.deletions : input.deletions,
    lines,
  }
}

/** Rebuild a unified diff patch text from a DiffDocument (renderer input). */
export function buildPatch(document: DiffDocument): string {
  const oldPath = document.change === 'added' ? '/dev/null' : `a/${document.path}`
  const newPath = document.change === 'deleted' ? '/dev/null' : `b/${document.path}`
  const header = [
    `diff --git a/${document.path} b/${document.path}`,
    `--- ${oldPath}`,
    `+++ ${newPath}`,
  ]
  // Hunk headers are regenerated from the line numbers: documents built from
  // review files carry no `hunk` rows, and Pierre's parsePatchFiles ignores
  // a patch without `@@` headers entirely (0 hunks → empty render).
  const body: string[] = []
  let hunkLines: string[] = []
  let oldStart = 0
  let newStart = 0
  let oldCount = 0
  let newCount = 0
  let prevOldEnd = 0
  let prevNewEnd = 0

  const flushHunk = (): void => {
    if (hunkLines.length === 0) return
    body.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...hunkLines)
    hunkLines = []
  }

  for (const line of document.lines) {
    if (line.kind === 'hunk') continue
    const text = line.kind === 'added'
      ? `+${line.text}`
      : line.kind === 'removed'
        ? `-${line.text}`
        : ` ${line.text}`
    const curOldStart = line.oldLine ?? prevOldEnd
    const curNewStart = line.newLine ?? prevNewEnd
    // A gap on BOTH sides starts a new hunk (standard unified-diff rule).
    if (hunkLines.length > 0 && curOldStart > prevOldEnd + 1 && curNewStart > prevNewEnd + 1) {
      flushHunk()
    }
    if (hunkLines.length === 0) {
      oldStart = line.oldLine ?? prevOldEnd
      newStart = line.newLine ?? prevNewEnd
      oldCount = 0
      newCount = 0
    }
    hunkLines.push(text)
    if (line.oldLine !== null) {
      oldCount += 1
      prevOldEnd = line.oldLine
    }
    if (line.newLine !== null) {
      newCount += 1
      prevNewEnd = line.newLine
    }
  }
  flushHunk()
  return [...header, ...body].join('\n')
}

export type DiffCollectionSummary = Readonly<{
  fileCount: number
  additions: number
  deletions: number
}>

export function summarizeDiffDocuments(documents: ReadonlyArray<DiffDocument>): DiffCollectionSummary {
  const additions = documents.reduce((sum, doc) => sum + doc.additions, 0)
  const deletions = documents.reduce((sum, doc) => sum + doc.deletions, 0)
  return { fileCount: documents.length, additions, deletions }
}

function parsePatchLines(patch: string): ReadonlyArray<DiffLine> {
  if (patch.length === 0) return []
  let oldLine = 0
  let newLine = 0
  const lines: DiffLine[] = []
  for (const text of patch.split('\n')) {
    if (text.startsWith('@@')) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text)
      oldLine = Number(match?.[1] ?? 0)
      newLine = Number(match?.[2] ?? 0)
      lines.push(makeDiffLine({ kind: 'hunk', text, oldLine: null, newLine: null }))
      continue
    }

    if (text.startsWith('+') && !text.startsWith('+++')) {
      const lineText = text.slice(1)
      lines.push(makeDiffLine({
        kind: 'added',
        text: lineText,
        oldLine: null,
        newLine: newLine++,
      }))
      continue
    }
    if (text.startsWith('-') && !text.startsWith('---')) {
      const lineText = text.slice(1)
      lines.push(makeDiffLine({
        kind: 'removed',
        text: lineText,
        oldLine: oldLine++,
        newLine: null,
      }))
      continue
    }
    if (text.startsWith(' ') || text === '') {
      const contextText = text.startsWith(' ') ? text.slice(1) : text
      lines.push(makeDiffLine({
        kind: 'context',
        text: contextText,
        oldLine: oldLine++,
        newLine: newLine++,
      }))
      continue
    }
    // File headers (`diff --git`, `index`, `---`, `+++`, `\ No newline`)
    // carry no line content — skip them.
  }
  return lines
}

function countLineStats(lines: ReadonlyArray<DiffLine>): {
  additions: number
  deletions: number
} {
  let additions = 0
  let deletions = 0
  for (const line of lines) {
    if (line.kind === 'added') additions += 1
    else if (line.kind === 'removed') deletions += 1
  }
  return { additions, deletions }
}

function makeDiffLine(
  input: Readonly<{
    kind: DiffLineKind
    text: string
    oldLine: number | null
    newLine: number | null
  }>,
): DiffLine {
  return {
    ...input,
    displayText: toDisplayText(input.text),
    oldLineLabel: formatLineNumber(input.oldLine),
    newLineLabel: formatLineNumber(input.newLine),
  }
}

function formatLineNumber(line: number | null): string {
  return line === null ? ' ' : String(line)
}

function toDisplayText(text: string): string {
  return text.length > 0 ? text : ' '
}
