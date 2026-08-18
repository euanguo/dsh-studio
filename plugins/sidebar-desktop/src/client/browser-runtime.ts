/**
 * Retained live URL memory for browser tabs and center surfaces.
 * (Ported from Orca's `browser-runtime.ts` pattern).
 *
 * Preserves the last-navigated URL per tabId across surface remounts and
 * tab switching without requiring disk writes.
 */

const liveBrowserUrlByTabId = new Map<string, string>()

export function rememberLiveBrowserUrl(tabId: string, url: string): void {
  if (!tabId || !url || url === 'about:blank') return
  liveBrowserUrlByTabId.set(tabId, url)
}

export function getLiveBrowserUrl(tabId: string): string | null {
  return liveBrowserUrlByTabId.get(tabId) ?? null
}

export function clearLiveBrowserUrl(tabId: string): void {
  liveBrowserUrlByTabId.delete(tabId)
}

export function clearAllLiveBrowserUrls(): void {
  liveBrowserUrlByTabId.clear()
}
