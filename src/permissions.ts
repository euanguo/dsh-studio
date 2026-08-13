export function originOf(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    return new URL(value).origin
  } catch {
    return undefined
  }
}

/** Allow only clipboard writes from the live DSH document in the main window. */
export function allowsRuntimeClipboardWrite(input: {
  isMainFrame: boolean
  permission: string
  requestingOrigin: string | undefined
  requestingUrl?: string
  runtimeOrigin: string | undefined
  webContentsIsMainWindow: boolean
}): boolean {
  if (input.permission !== 'clipboard-sanitized-write') return false
  if (!input.webContentsIsMainWindow || !input.isMainFrame) return false
  if (input.runtimeOrigin === undefined || originOf(input.requestingOrigin) !== input.runtimeOrigin) return false

  const requestingUrlOrigin = originOf(input.requestingUrl)
  return input.requestingUrl === undefined || requestingUrlOrigin === input.runtimeOrigin
}
