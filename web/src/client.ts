/** Browser face of the DSH Studio Web shell. */

import {
  DSH_STUDIO_SURFACE_VIEW_SERVICE,
  type DshStudioSurfaceView,
} from '@dsh-studio/shared/surface'

interface ClientContext {
  effect(effect: () => (() => void) | void, label?: string): void
  reflect: {
    provide(name: string, value: unknown, options?: unknown): (() => Promise<void> | void) | void
  }
}

/** Enroll the web shell identity and the client-plane surface contract. */
export function apply(ctx: ClientContext): void {
  // The unified three-surface contract, client plane: the web shell.
  ctx.reflect.provide(DSH_STUDIO_SURFACE_VIEW_SERVICE, Object.freeze({
    kind: 'web',
  } satisfies DshStudioSurfaceView), undefined)
  ctx.effect(() => {
    const originalTitle = document.title
    document.title = 'DSH Studio Web'
    return () => { document.title = originalTitle }
  }, 'dsh-studio-web: shell identity')
  ctx.effect(() => {
    const headlineCopy = new Set([
      'Into the Unknown',
      '探索未知之境',
      '探索未至之境',
    ])
    const originalHeadlines = new Map<HTMLElement, string>()
    const synchronize = (): void => {
      for (const element of document.querySelectorAll<HTMLElement>('span')) {
        const text = element.textContent?.trim() ?? ''
        if (!headlineCopy.has(text)) continue
        if (!originalHeadlines.has(element)) originalHeadlines.set(element, text)
        element.textContent = 'DSH Studio Web'
        element.dataset.dshStudioWebHeroHeadline = 'true'
      }
    }
    const observer = new MutationObserver(synchronize)
    observer.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
    })
    synchronize()
    return () => {
      observer.disconnect()
      for (const [element, original] of originalHeadlines) {
        if (element.isConnected && element.textContent === 'DSH Studio Web') {
          element.textContent = original
        }
        delete element.dataset.dshStudioWebHeroHeadline
      }
    }
  }, 'dsh-studio-web: hero identity')
}
