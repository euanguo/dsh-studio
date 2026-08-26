/**
 * UI chrome domain lifecycle for the capability gateway. One official domain
 * store backs tab/layout persistence; the nested storage-domain injection
 * keeps the optional service out of the route lifetime — consumers close over
 * the stable face getter ({@link UiChromeLifecycle.awaitFace}) and the gate,
 * never the child context. A dark domain is loud on purpose: it would
 * silently drop every restore/save.
 */
import { errorMessage } from '@dsh-studio/shared/errors'
import { UI_CHROME_DOMAIN, createUiChromeFace, type UiChromeDomain } from '../ui-chrome-domain.ts'
import type { UiChromeFace } from '../routes/ui-chrome.ts'
import type { Context } from '../context-types.ts'

export interface UiChromeLifecycle {
  awaitFace(): Promise<UiChromeFace | undefined>
}

export function createUiChromeDomain(ctx: Context): UiChromeLifecycle {
  let uiChromeFace: UiChromeFace | undefined
  let uiChromeGate: Promise<void> | undefined
  ctx.inject(['storageDomain'], (storageCtx) => {
    let disposed = false
    let domain: UiChromeDomain | undefined
    uiChromeGate = storageCtx.storageDomain.open(UI_CHROME_DOMAIN).then(
      (opened) => {
        const candidate = opened as UiChromeDomain
        if (disposed) {
          void candidate.close()
          return
        }
        domain = candidate
        uiChromeFace = createUiChromeFace(candidate)
      },
      (error) => {
        // Loud on purpose: a dark ui-chrome domain silently drops every tab/
        // layout persistence (nothing restores, nothing saves). The plugin
        // context owns the logger; the storage child context may not have one.
        ctx.logger?.warn?.(`[ui-chrome] domain open failed: ${errorMessage(error)}`)
      },
    )
    storageCtx.effect(() => () => {
      disposed = true
      if (domain === undefined) return
      const closing = domain
      domain = undefined
      uiChromeFace = undefined
      void closing.close()
    })
  })
  return {
    awaitFace: async () => {
      await uiChromeGate
      return uiChromeFace
    },
  }
}
