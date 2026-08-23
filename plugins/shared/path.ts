/**
 * Browser-safe path helpers shared by the sidebar host and the renderer.
 *
 * The sidebar wire protocol and git output use forward slashes; these
 * helpers are pure string operations so the renderer bundles can use them
 * (node:path does not exist in the browser). The host keeps node:path for
 * filesystem work; this module is only for wire-side normalization.
 *
 * Primitive path math (basename / dirname / join) delegates to `pathe`, the
 * standard browser-safe path library. The remaining helpers stay hand-written
 * ON PURPOSE: they implement DSH wire-protocol semantics that a generic path
 * library deliberately does NOT provide — trailing-slash stripping, literal
 * `..` preservation (never resolving dot segments), containment checks with
 * a prefix boundary, and cwd-relative conversion that never emits `../`.
 */
import {
  basename as pathBasename,
  dirname as pathDirname,
  join as pathJoin,
} from 'pathe'

/** Normalize separators, collapse repeats and strip trailing slashes ('' stays ''). */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/+$/, '')
}

/** Last non-empty segment of a path (the input itself when there is none, e.g. '/'). */
export function basename(path: string): string {
  const normalized = normalizePath(path)
  if (normalized === '') return path
  return pathBasename(normalized)
}

/** Parent directory of a path: '' for a bare name, '/' for a top-level name. */
export function dirname(path: string): string {
  const normalized = normalizePath(path)
  if (normalized === '') return ''
  const dir = pathDirname(normalized)
  if (dir === '.') return ''
  if (dir === '/') return '/'
  // `pathe` keeps the drive-root slash ('C:/' for 'C:/x'); the wire form
  // never carries a trailing slash outside root.
  return dir.replace(/\/+$/, '')
}

/**
 * Join segments with '/' and normalize the result. Note: `pathe.join`
 * resolves '.' / '..' segments; callers only pass clean names (file names,
 * slugified worktree names), so the wire's literal-`..` behavior never
 * triggers here.
 */
export function joinPath(...segments: string[]): string {
  return normalizePath(pathJoin(...segments))
}

/** True when `path` is `root` itself or a descendant of it. */
export function isUnderRoot(root: string, path: string): boolean {
  const normalizedRoot = normalizePath(root)
  const normalizedPath = normalizePath(path)
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)
}

/** cwd-relative wire path → absolute path ('' means the cwd itself). */
export function resolveCapabilitiesPath(cwd: string, relativePath: string): string {
  if (relativePath === '') return cwd
  const root = normalizePath(cwd)
  const relative = relativePath.replace(/^[/\\]+/, '').replace(/\\/g, '/')
  return `${root}/${relative}`
}

/** Absolute path → cwd-relative wire path (paths outside the cwd fall back to the stripped absolute form). */
export function relativePathOf(cwd: string, absolute: string): string {
  const root = normalizePath(cwd)
  const value = normalizePath(absolute)
  if (value === root) return ''
  if (value.startsWith(`${root}/`)) return value.slice(root.length + 1)
  return absolute.replace(/^[/\\]+/, '').replace(/\\/g, '/')
}