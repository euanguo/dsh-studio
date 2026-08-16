import type { DesktopSkin } from './skins.ts'

const SKIN_ATTRIBUTE = 'data-oh-dsh-skin'
const ATMOSPHERE_STYLE_ID = 'oh-dsh-desktop-skins-atmosphere'

export interface SkinDomPort {
  apply(skin: DesktopSkin | undefined): void
  dispose(): void
}

/** Owns only the skin attribute and atmosphere stylesheet it creates. */
export class SkinDomPresenter implements SkinDomPort {
  private readonly target: Document | undefined

  constructor(target: Document | undefined) {
    this.target = target
  }

  apply(skin: DesktopSkin | undefined): void {
    if (this.target === undefined) return
    const body = this.target.body
    const existing = this.target.getElementById(ATMOSPHERE_STYLE_ID)
    if (skin === undefined) {
      body.removeAttribute(SKIN_ATTRIBUTE)
      existing?.remove()
      return
    }
    body.setAttribute(SKIN_ATTRIBUTE, skin.id)
    if (skin.css === undefined) {
      existing?.remove()
      return
    }
    const style = existing ?? this.target.createElement('style')
    style.id = ATMOSPHERE_STYLE_ID
    style.dataset.ohDshDesktopSkins = 'atmosphere'
    if (style.textContent !== skin.css) style.textContent = skin.css
    if (style.parentElement === null) this.target.head.append(style)
  }

  dispose(): void {
    this.apply(undefined)
  }
}
