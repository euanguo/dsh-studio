/**
 * DSH Studio surface contract: every packaged shell identifies the interaction
 * form it provides through one `dshStudioSurface` service. Built-in plugins read
 * this service and adapt explicitly per surface instead of guessing from
 * environment variables or window presence.
 *
 * - `desktop` — the Electron shell (`@dsh-studio/desktop`): native windows and
 *   menus, the Electron bridge, and the full local capability set.
 * - `web` — the browser shell (`@dsh-studio/web`): the DSH web UI served over
 *   HTTP. The browser client graph matches desktop wherever the host
 *   services exist (skins, pinned summary, sidebar, terminal dock); only
 *   Electron-bound surfaces (native chrome, the marketplace bridge) differ.
 * - `tui` — the future terminal shell (`@dsh-studio/tui`): no browser client
 *   graph, and host plugins that need `webServer` never activate.
 */

/** The three interaction forms a shell can provide. */
export type DshStudioSurfaceKind = 'desktop' | 'web' | 'tui'

/** Host-plane surface facts provided by the active shell bundle. */
export interface DshStudioSurface {
  dataRoot: string
  kind: DshStudioSurfaceKind
  platform: NodeJS.Platform
  profile: string
  version: string
}

/** Service name shells provide the surface under (host plane). */
export const DSH_STUDIO_SURFACE_SERVICE = 'dshStudioSurface' as const

/** Browser-plane surface facts reflected by the active shell client. */
export interface DshStudioSurfaceView {
  kind: DshStudioSurfaceKind
}

/** Service name shell clients reflect the surface under (client plane). */
export const DSH_STUDIO_SURFACE_VIEW_SERVICE = 'dshStudioSurface' as const
