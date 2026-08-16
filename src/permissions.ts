export function originOf(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    return new URL(value).origin
  } catch {
    return undefined
  }
}

/**
 * Gate clipboard permissions for the live DSH document in the main window.
 *
 * Electron 42 routes `navigator.clipboard.writeText` through the
 * `clipboard-read` permission request (Chromium's sanitized-write gate), so
 * both that and `clipboard-sanitized-write` must be allowed for Web
 * Clipboard API writes to work. Everything else stays gated: the request
 * must come from the runtime's own origin in the main frame of the main
 * window.
 */
export function allowsRuntimeClipboardWrite(input: {
  isMainFrame: boolean
  permission: string
  requestingOrigin: string | undefined
  requestingUrl?: string
  runtimeOrigin: string | undefined
  webContentsIsMainWindow: boolean
}): boolean {
  const clipboardPermissions = ['clipboard-sanitized-write', 'clipboard-read']
  if (!clipboardPermissions.includes(input.permission)) return false
  if (!input.webContentsIsMainWindow || !input.isMainFrame) return false
  if (input.runtimeOrigin === undefined || originOf(input.requestingOrigin) !== input.runtimeOrigin) return false

  const requestingUrlOrigin = originOf(input.requestingUrl)
  return input.requestingUrl === undefined || requestingUrlOrigin === input.runtimeOrigin
}
