// Whole-block allowBuild protocol for pnpm-workspace.yaml (leaf-3.3).
// Everything between the begin/end markers is owned by this module; the
// rewrite never performs regex surgery on the surrounding YAML.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const BUILD_BEGIN = '# >>> DSH Studio allowed plugin builds'
export const BUILD_END = '# <<< DSH Studio allowed plugin builds'

function yamlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/** One `  'name': true` (or legacy bare `name: true`) entry inside the
 *  managed block; anything else in the interior is ignored. */
function managedEntryName(line: string): string | null {
  const match = /^[ \t]+(?:'((?:[^']|'')*)'|([^#' \t][^:#]*?)):[ \t]*true[ \t\r]*$/.exec(line)
  if (match === null) return null
  if (match[1] !== undefined) return match[1].replaceAll("''", "'")
  return match[2]?.trim() ?? null
}

/**
 * The rewrite strips the marked block, rejects any foreign `allowBuilds`
 * key outside it with its line number, and deterministically regenerates one
 * sorted block — replacing the old block in place or appending one at the
 * end. Every other line — comments, quoting, CRLF endings — survives
 * byte-for-byte, and reruns over the same inputs produce identical bytes.
 */
export function regenerateManagedAllowBuilds(text: string, packageNameValue: string): string {
  const lines = text.split('\n')
  let beginLine = -1
  let endLine = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.includes(BUILD_BEGIN) === true) {
      beginLine = index
      break
    }
  }
  if (beginLine >= 0) {
    for (let index = beginLine + 1; index < lines.length; index += 1) {
      if (lines[index]?.includes(BUILD_END) === true) {
        endLine = index
        break
      }
    }
    if (endLine < 0) throw new Error(`managed configuration block is missing ${BUILD_END}`)
  }
  for (let index = 0; index < lines.length; index += 1) {
    if (beginLine >= 0 && index >= beginLine && index <= endLine) continue
    if (/^[ \t]*allowBuilds[ \t]*:/.test(lines[index] ?? '')) {
      throw new Error(
        `pnpm-workspace.yaml line ${index + 1} has an allowBuilds key outside the managed `
        + `${BUILD_BEGIN} block; move it between the markers or remove it`,
      )
    }
  }
  const names = new Set<string>([packageNameValue])
  if (beginLine >= 0) {
    for (let index = beginLine + 1; index < endLine; index += 1) {
      const name = managedEntryName(lines[index] ?? '')
      if (name !== null) names.add(name)
    }
  }
  const block = [
    BUILD_BEGIN,
    'allowBuilds:',
    ...[...names].sort().map(name => `  ${yamlString(name)}: true`),
    BUILD_END,
  ]
  if (beginLine < 0) {
    // No managed block yet: append one after a single blank line, keeping a
    // single trailing newline regardless of the original file's shape.
    while (lines.at(-1) === '') lines.pop()
    return [...lines, '', ...block, ''].join('\n')
  }
  // In-place replacement: every line outside the marked block keeps its
  // exact bytes.
  return [...lines.slice(0, beginLine), ...block, ...lines.slice(endLine + 1)].join('\n')
}

/** Idempotently grant the package a slot in the managed allowBuilds block. */
export function allowBuild(profileDir: string, packageNameValue: string): void {
  const path = join(profileDir, 'pnpm-workspace.yaml')
  const original = existsSync(path) ? readFileSync(path, 'utf8') : 'packages:\n  - .\n'
  writeFileSync(path, regenerateManagedAllowBuilds(original, packageNameValue), { mode: 0o600 })
}
