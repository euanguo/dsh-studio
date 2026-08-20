/**
 * Idempotent, self-healing style injection (@dsh-studio/shared).
 *
 * Every browser plugin mounts its stylesheet by appending a `<style>` to
 * document.head. DSH's client hot-reload rebuilds parts of the document and
 * can drop foreign `<style>` nodes, after which the plugin's surface renders
 * unstyled (the marketplace regression: the surface collapsed into a static
 * layout and stretched the page). `ensureStyle` gives every plugin the same
 * mount discipline:
 *
 * - IDEMPOTENT: the style is keyed by one stable `id`; a remount (HMR,
 *   service restart) reuses the existing element and only rewrites the
 *   text when the CSS actually changed.
 * - SELF-HEALING: a document.head observer re-appends the element if
 *   anything removes it. The observer reacts to removals of OUR node
 *   only, so it never loops on its own writes or on foreign styles.
 *
 * The returned disposer removes the element and stops the observer —
 * wire it into the service's dispose path like any other resource.
 */

/** One live injected style: the element plus its healing observer. */
interface InjectedStyle {
  element: HTMLStyleElement
  observer: MutationObserver
  references: number
}

/** Every ensureStyle id currently mounted in this document. */
const liveStyles = new Map<string, InjectedStyle>()

/**
 * Mount (or refresh) one identified stylesheet.
 *
 * @param id - Stable style identity; becomes the element's
 *   `data-dsh-studio-style` marker and the healing key. One id = one element,
 *   no matter how many callers ensure it.
 * @param css - The stylesheet text (usually the plugin's concatenated
 *   CSS-module strings).
 * @returns A disposer that releases one reference; the style is removed after
 *   the final disposer runs.
 */
export function ensureStyle(id: string, css: string): () => void {
  const existing = liveStyles.get(id)
  if (existing !== undefined) {
    if (existing.element.textContent !== css) {
      existing.element.textContent = css
    }
    existing.references += 1
    let released = false
    return () => {
      if (released) return
      released = true
      releaseStyle(id)
    }
  }
  const element = document.createElement('style')
  element.dataset.dshStudioStyle = id
  element.textContent = css
  document.head.append(element)
  // Self-healing: re-append when anything strips the element out of
  // document.head. Only OUR removals count; appends (ours or foreign)
  // never fire the heal, so there is no feedback loop.
  const observer = new MutationObserver(() => {
    if (element.isConnected) return
    if (!liveStyles.has(id)) return
    document.head.append(element)
  })
  observer.observe(document.head, { childList: true })
  liveStyles.set(id, { element, observer, references: 1 })
  let released = false
  return () => {
    if (released) return
    released = true
    releaseStyle(id)
  }
}

/** Release one mount reference and tear down the final live style. */
function releaseStyle(id: string): void {
  const live = liveStyles.get(id)
  if (live === undefined) return
  live.references -= 1
  if (live.references > 0) return
  liveStyles.delete(id)
  live.observer.disconnect()
  live.element.remove()
}
