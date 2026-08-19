/**
 * Canonical data-root vocabulary (directory names + environment variable
 * names), single-sourced for BOTH layers:
 *   - the app layer (`src/data-root.ts`) owns the resolution logic and
 *     re-exports these names, and
 *   - the plugin layer (`@dsh-studio/sidebar-host`) consumes them to derive
 *     plugin-scoped defaults (e.g. the worktree store root) without
 *     importing app code.
 * Keeping the literals here means `.dsh-studio` / `.dsh-studio-dev` and the
 * env names are never re-typed (AGENTS.md: do not duplicate data roots).
 * Pure strings only — this module loads in browser bundles.
 */

/** Environment variable overriding the shared DSH Studio state root. */
export const DSH_STUDIO_HOME_ENV = 'DSH_STUDIO_HOME'

/** Environment variable selecting the stable/dev data-root pair. */
export const DSH_STUDIO_CHANNEL_ENV = 'DSH_STUDIO_CHANNEL'

/** Installed Desktop and everyday Web/TUI state. */
export const DSH_STUDIO_STABLE_CHANNEL = 'stable'

/** Source launches and verification instances. */
export const DSH_STUDIO_DEV_CHANNEL = 'dev'

/** Default directory shared by the Desktop, Web, and TUI surfaces. */
export const DEFAULT_DSH_STUDIO_HOME_DIRECTORY = '.dsh-studio'

/** Isolated sibling of the stable root for source and verification launches. */
export const DEFAULT_DSH_STUDIO_DEV_HOME_DIRECTORY = '.dsh-studio-dev'

/**
 * Directory name for one channel under the user home.
 * Mirrors `dshStudioHomeDirectory` in `src/data-root.ts` (the app-layer
 * resolver); kept as data so plugin-side fallbacks compose the same pair.
 */
export function dshStudioHomeDirectoryName(
  channel: string,
): string {
  return channel === DSH_STUDIO_DEV_CHANNEL
    ? DEFAULT_DSH_STUDIO_DEV_HOME_DIRECTORY
    : DEFAULT_DSH_STUDIO_HOME_DIRECTORY
}
