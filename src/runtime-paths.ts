import { existsSync } from 'node:fs'
import { posix, win32 } from 'node:path'

/** Files bundled beside the packaged Electron application. */
export interface BundledRuntimePaths {
  cliEntry: string
  /**
   * The standalone Node interpreter file (Web/TUI distributions and the dev
   * stage ship a real binary; the packaged desktop app replaces it with the
   * `node`/`node.cmd` shared-Node adapter).
   */
  nodeBinary: string
  /** The spawnable Node command in this layout (adapter or real binary). */
  nodeCommand: string
  nodeBinDirectory: string
  pnpmBinary: string
  pnpmEntry: string
  runtimeRoot: string
}

function pathApi(platform: NodeJS.Platform): typeof posix | typeof win32 {
  return platform === 'win32' ? win32 : posix
}

/** Resolve an explicit distribution root before Electron's packaged/dev defaults. */
export function resolveRuntimeResourcesRoot(
  packagedRoot: string,
  developmentRoot: string,
  isPackaged: boolean,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = environment.DSH_STUDIO_RESOURCES_ROOT ?? environment.DSH_STUDIO_WEB_ROOT
  if (explicit !== undefined && explicit !== '') return explicit
  return isPackaged ? packagedRoot : developmentRoot
}

/** Resolve the bundled DSH and Node entry points for one target platform. */
export function bundledRuntimePaths(
  resourcesRoot: string,
  platform: NodeJS.Platform = process.platform,
): BundledRuntimePaths {
  const paths = pathApi(platform)
  const runtimeRoot = paths.join(resourcesRoot, 'dsh-runtime')
  const nodeRoot = paths.join(resourcesRoot, 'node-runtime')
  const nodeBinDirectory = platform === 'win32'
    ? nodeRoot
    : paths.join(nodeRoot, 'bin')
  return {
    cliEntry: paths.join(runtimeRoot, 'lib', 'bin.js'),
    nodeBinary: paths.join(nodeBinDirectory, platform === 'win32' ? 'node.exe' : 'node'),
    nodeCommand: paths.join(nodeBinDirectory, platform === 'win32' ? 'node.cmd' : 'node'),
    nodeBinDirectory,
    pnpmBinary: paths.join(nodeBinDirectory, platform === 'win32' ? 'pnpm.cmd' : 'pnpm'),
    pnpmEntry: paths.join(
      nodeRoot,
      ...(platform === 'win32' ? ['node_modules'] : ['lib', 'node_modules']),
      'pnpm',
      'bin',
      'pnpm.mjs',
    ),
    runtimeRoot,
  }
}

/**
 * Whether this layout carries a spawnable Node interpreter: the standalone
 * binary (Web/TUI distributions) or the shared-Node adapter (desktop app on
 * every platform, where the real binary was replaced at package time).
 */
export function nodeInterpreterAvailable(
  paths: BundledRuntimePaths,
): boolean {
  return existsSync(paths.nodeBinary) || existsSync(paths.nodeCommand)
}

/** Which side of PATH wins for one child environment. */
export type RuntimePathOrder = 'bundled-first' | 'user-first'

function dedupePathEntries(entries: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of entries) {
    if (entry === '' || seen.has(entry)) continue
    seen.add(entry)
    result.push(entry)
  }
  return result
}

/**
 * Compose PATH for one child environment.
 *
 * - `bundled-first`: the app's own Node and runtime bin directories win, so
 *   internal tooling (marketplace builds, previews) keeps using the shared
 *   Electron Node no matter what the login shell exported. Default, and the
 *   only order Web/TUI distributions need.
 * - `user-first`: the user's login-shell PATH wins and the bundled directories
 *   are only a fallback tail. User-scoped Desktop processes (Agent terminals,
 *   Git, user commands) then see the user's real `node`, `pnpm`, and tools
 *   instead of the packaged shared-Node adapters.
 */
export function runtimeSearchPath(
  paths: BundledRuntimePaths,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  order: RuntimePathOrder = 'bundled-first',
): string {
  const path = pathApi(platform)
  const inherited = environment.PATH
    ?? (platform === 'win32' ? environment.Path : undefined)
    ?? (platform === 'win32' ? '' : '/usr/bin:/bin:/usr/sbin:/sbin')
  const bundled = [
    paths.nodeBinDirectory,
    path.join(paths.runtimeRoot, 'node_modules', '.bin'),
  ]
  const extra = platform === 'darwin' ? ['/opt/homebrew/bin', '/usr/local/bin'] : []
  if (order === 'user-first') {
    const userEntries = inherited.split(path.delimiter)
    return dedupePathEntries([...userEntries, ...extra, ...bundled]).join(path.delimiter)
  }
  return [...bundled, ...extra, ...(inherited === '' ? [] : [inherited])]
    .filter(entry => entry !== '')
    .join(path.delimiter)
}
