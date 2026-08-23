import type { RuntimeLauncher } from './runtime.ts'

/** The runtime-paths fields the desktop interpreter plumbing resolves. */
export interface DesktopInterpreterPaths {
  pnpmEntry: string
}

/**
 * Namespaced interpreter plumbing for inherited environments: the shared-Node
 * adapters under node-runtime/bin resolve their executable and pnpm entry from
 * these injected variables, so descendants keep pointing at this app's own
 * Electron even after any environment scrubbing between launches. Every key is
 * `DSH_STUDIO_*`-namespaced and therefore cannot collide with any program's
 * global semantics — this object is safe to merge into child environments.
 */
export function desktopNodeEnv(
  paths: DesktopInterpreterPaths,
  execPath: string,
): NodeJS.ProcessEnv {
  return {
    DSH_STUDIO_NODE_EXECUTABLE: execPath,
    DSH_STUDIO_PNPM_ENTRY: paths.pnpmEntry,
  }
}

/**
 * Exec-boundary environment for spawning the app's own Electron binary AS a
 * Node interpreter. `ELECTRON_RUN_AS_NODE` carries global semantics (every
 * Electron binary on the system honors it), so it must exist only in the
 * spawn environment of that one launch — never in an inherited command
 * environment. Callers that only compose inherited environments use
 * {@link desktopNodeEnv}; callers that exec the interpreter use this.
 */
export function desktopInterpreterSpawnEnv(
  paths: DesktopInterpreterPaths,
  execPath: string,
): NodeJS.ProcessEnv {
  return {
    ...desktopNodeEnv(paths, execPath),
    ELECTRON_RUN_AS_NODE: '1',
  }
}

/**
 * Launcher that execs the shared Electron interpreter directly (no wrapper).
 * The returned env carries the run-as-node variable exactly because this
 * launch is the interpreter exec boundary.
 */
export function desktopNodeLauncher(
  paths: DesktopInterpreterPaths,
  execPath: string = process.execPath,
): RuntimeLauncher {
  return {
    command: execPath,
    env: desktopInterpreterSpawnEnv(paths, execPath),
    interpreter: true,
  }
}
