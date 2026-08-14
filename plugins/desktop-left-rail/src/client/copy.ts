/**
 * Clipboard write with an execCommand fallback. Electron's `navigator.clipboard`
 * writeText can reject with NotAllowedError ("Document is not focused") even
 * when the window is focused — the deprecated-but-present execCommand path is
 * the reliable fallback there (and on insecure hosts).
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText !== undefined) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to execCommand.
    }
  }
  const el = document.createElement('textarea')
  el.value = text
  el.setAttribute('readonly', '')
  el.style.position = 'fixed'
  el.style.left = '-9999px'
  document.body.appendChild(el)
  el.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    el.remove()
  }
}
