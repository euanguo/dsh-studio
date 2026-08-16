import { DESKTOP_SKINS, desktopSkin, type DesktopSkin } from './skins.ts'
import type { SkinDomPort } from './skin-dom.ts'
import {
  ACTIVE_SKIN_KEY,
  FALLBACK_THEME_KEY,
} from '../preferences.ts'

export { ACTIVE_SKIN_KEY, FALLBACK_THEME_KEY } from '../preferences.ts'

export interface ThemeSnapshot {
  preference: string
  active: {
    id: string
    colorScheme: 'light' | 'dark'
    tokens: Readonly<Record<string, string>>
  }
  revision: number
}

export interface ThemeService {
  getTheme(): ThemeSnapshot
  register(skin: Pick<DesktopSkin, 'id' | 'colorScheme' | 'tokens'>): () => void
  setTheme(id: string): void
}

export interface StorageLike {
  getItem(key: string): string | null
  removeItem(key: string): void
  setItem(key: string, value: string): void
}

export interface DesktopSkinsSnapshot {
  activeId: string | null
  revision: number
}

export interface DesktopSkins {
  getSnapshot(): DesktopSkinsSnapshot
  setSkin(id: string | null): void
  subscribe(listener: () => void): () => void
}

const BUILTIN_PREFERENCES = new Set(['light', 'dark', 'system'])

function builtinPreference(value: string | null): value is 'light' | 'dark' | 'system' {
  return value !== null && BUILTIN_PREFERENCES.has(value)
}

/** Coordinates the official theme registry, durable skin choice, and DOM. */
export class DesktopSkinsController implements DesktopSkins {
  private readonly listeners = new Set<() => void>()
  private readonly registrations: Array<() => void> = []
  private readonly theme: ThemeService
  private readonly storage: StorageLike
  private readonly dom: SkinDomPort
  private snapshot: DesktopSkinsSnapshot = Object.freeze({ activeId: null, revision: 0 })
  private started = false

  constructor(
    theme: ThemeService,
    storage: StorageLike,
    dom: SkinDomPort,
  ) {
    this.theme = theme
    this.storage = storage
    this.dom = dom
  }

  start(): void {
    if (this.started) return
    this.started = true
    try {
      for (const skin of DESKTOP_SKINS) {
        this.registrations.push(this.theme.register({
          id: skin.id,
          colorScheme: skin.colorScheme,
          tokens: skin.tokens,
        }))
      }
      const stored = this.read(ACTIVE_SKIN_KEY)
      const skin = stored === null ? undefined : desktopSkin(stored)
      if (skin === undefined) {
        if (stored !== null) this.remove(ACTIVE_SKIN_KEY)
      } else {
        const preference = this.theme.getTheme().preference
        if (builtinPreference(preference) && !builtinPreference(this.read(FALLBACK_THEME_KEY))) {
          this.write(FALLBACK_THEME_KEY, preference)
        }
        this.theme.setTheme(skin.id)
      }
      this.adopt(this.theme.getTheme())
    } catch (error) {
      this.disposeRegistrations()
      this.started = false
      throw error
    }
  }

  adopt(snapshot: ThemeSnapshot): void {
    if (!this.started) return
    const skin = desktopSkin(snapshot.active.id)
    if (skin === undefined) {
      this.remove(ACTIVE_SKIN_KEY)
      if (builtinPreference(snapshot.preference)) {
        this.write(FALLBACK_THEME_KEY, snapshot.preference)
      }
      this.dom.apply(undefined)
      this.publish(null)
      return
    }
    this.write(ACTIVE_SKIN_KEY, skin.id)
    this.dom.apply(skin)
    this.publish(skin.id)
  }

  dispose(): void {
    if (!this.started) return
    const fallback = this.fallbackPreference()
    this.started = false
    if (this.snapshot.activeId !== null) this.theme.setTheme(fallback)
    this.disposeRegistrations()
    this.dom.dispose()
  }

  getSnapshot(): DesktopSkinsSnapshot {
    return this.snapshot
  }

  setSkin(id: string | null): void {
    if (!this.started) throw new Error('desktop skins controller is not started')
    if (id === null) {
      this.remove(ACTIVE_SKIN_KEY)
      this.theme.setTheme(this.fallbackPreference())
      this.adopt(this.theme.getTheme())
      return
    }
    const skin = desktopSkin(id)
    if (skin === undefined) throw new Error(`unknown desktop skin: ${id}`)
    const preference = this.theme.getTheme().preference
    if (builtinPreference(preference)) this.write(FALLBACK_THEME_KEY, preference)
    this.write(ACTIVE_SKIN_KEY, skin.id)
    this.theme.setTheme(skin.id)
    this.adopt(this.theme.getTheme())
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private disposeRegistrations(): void {
    for (const dispose of this.registrations.splice(0).reverse()) dispose()
  }

  private fallbackPreference(): 'light' | 'dark' | 'system' {
    const stored = this.read(FALLBACK_THEME_KEY)
    return builtinPreference(stored) ? stored : 'system'
  }

  private publish(activeId: string | null): void {
    if (this.snapshot.activeId === activeId) return
    this.snapshot = Object.freeze({
      activeId,
      revision: this.snapshot.revision + 1,
    })
    for (const listener of this.listeners) listener()
  }

  private read(key: string): string | null {
    try { return this.storage.getItem(key) } catch { return null }
  }

  private remove(key: string): void {
    try { this.storage.removeItem(key) } catch { /* best effort */ }
  }

  private write(key: string, value: string): void {
    try { this.storage.setItem(key, value) } catch { /* best effort */ }
  }
}
