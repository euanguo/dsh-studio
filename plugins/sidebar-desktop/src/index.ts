/**
 * Host entry of the sidebar-desktop add-on. The webview browser and the
 * desktop workspace picker are pure CLIENT capabilities, so there is no host
 * route here — this entry only keeps the plugin in the host graph so the
 * bundle layer registers it.
 */
export const name = 'oh-dsh-sidebar-desktop'
export const inject: string[] = []

export function apply(): void {}
