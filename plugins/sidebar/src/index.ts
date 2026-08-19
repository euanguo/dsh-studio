/**
 * DSH Studio sidebar, host half. The sidebar is a pure CLIENT plugin: every
 * panel capability (files, git, settings, jobs) reaches the vendored host
 * through the /sidebar/api wire contract served by @dsh-studio/sidebar-host.
 * This entry only keeps the plugin in the host cordis graph / Loader (load
 * and lifecycle follow the host; the browser half ships via
 * exports["./client"], discovered through the package.json dsh.client
 * declaration).
 */

/** Host plugin body — no host-side behavior for the sidebar plugin. */
export function apply(): void {}
