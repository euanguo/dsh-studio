/**
 * Pierre render recovery after the desktop window returns to the foreground.
 *
 * Pierre's render loop is rAF-driven (`UniversalRenderingManager`): while an
 * Electron window is hidden, Chromium pauses `requestAnimationFrame`
 * entirely, so a file/diff/editor surface opened in the background renders
 * nothing (only the virtualizer's total-size layout exists). On visibility
 * restore the pending rAF does not reschedule by itself — nothing re-queues
 * the window build, and scroll events do not bubble, so dispatching one on
 * an inner element never reaches the Virtualizer.
 *
 * The recovery synthesizes a scroll event on every Pierre Virtualizer host
 * (the scrolling element itself). `Virtualizer#handleElementScroll` marks
 * the window dirty and re-queues `computeRenderRangeAndEmit` even at an
 * unchanged scroll offset, so the window rows build immediately.
 */

const PIERRE_SCROLL_HOSTS = [
  // PierreFileView (code / markdown-source viewers).
  '.oh-dsh-pierre-file-host',
  // renderPierreDiff virtualized and natural (stacked) diff panes.
  '.oh-dsh-pierre-surface',
  '.oh-dsh-pierre-surface-natural',
  // Pierre editor state (in-place edit surface).
  '.oh-dsh-editor-host',
].join(', ')

export function registerPierreVisibilityRecovery(): () => void {
  const onVisibility = (): void => {
    if (document.visibilityState !== 'visible') return
    for (const host of document.querySelectorAll<HTMLElement>(PIERRE_SCROLL_HOSTS)) {
      host.dispatchEvent(new Event('scroll', { bubbles: true }))
    }
  }
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    document.removeEventListener('visibilitychange', onVisibility)
  }
}