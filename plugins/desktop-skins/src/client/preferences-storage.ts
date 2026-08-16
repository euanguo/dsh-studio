import {
  ACTIVE_SKIN_KEY,
  DEFAULT_SKIN_PREFERENCES,
  FALLBACK_THEME_KEY,
  PREFERENCES_API_PATH,
  isDesktopSkinId,
  isFallbackTheme,
  parseSkinPreferences,
  type DesktopSkinPreferences,
} from '../preferences.ts'
import type { StorageLike } from './skin-controller.ts'

interface FetchResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export type PreferencesFetch = (
  input: string,
  init?: { body?: string; headers?: Record<string, string>; method?: string },
) => Promise<FetchResponse>

/** Port-independent client cache backed by the desktop Host application data. */
export class DesktopSkinPreferencesStorage implements StorageLike {
  private readonly request: PreferencesFetch
  private preferences: DesktopSkinPreferences = DEFAULT_SKIN_PREFERENCES
  private dirty = false
  private loaded = false
  private flushing: Promise<void> | undefined

  constructor(request: PreferencesFetch) {
    this.request = request
  }

  async load(): Promise<void> {
    try {
      const response = await this.request(PREFERENCES_API_PATH)
      if (!response.ok) throw new Error(`desktop skin preferences load failed (${String(response.status)})`)
      const preferences = parseSkinPreferences(await response.json())
      if (preferences === undefined) throw new Error('desktop skin preferences response is invalid')
      this.preferences = preferences
    } finally {
      this.loaded = true
    }
  }

  getItem(key: string): string | null {
    if (key === ACTIVE_SKIN_KEY) return this.preferences.activeId
    if (key === FALLBACK_THEME_KEY) return this.preferences.fallbackTheme
    return null
  }

  removeItem(key: string): void {
    if (key === ACTIVE_SKIN_KEY) this.update({ activeId: null })
    if (key === FALLBACK_THEME_KEY) this.update({ fallbackTheme: 'system' })
  }

  setItem(key: string, value: string): void {
    if (key === ACTIVE_SKIN_KEY && isDesktopSkinId(value)) this.update({ activeId: value })
    if (key === FALLBACK_THEME_KEY && isFallbackTheme(value)) {
      this.update({ fallbackTheme: value })
    }
  }

  async settle(): Promise<void> {
    await this.flushing
  }

  private update(patch: Partial<DesktopSkinPreferences>): void {
    const next = Object.freeze({ ...this.preferences, ...patch })
    if (next.activeId === this.preferences.activeId
      && next.fallbackTheme === this.preferences.fallbackTheme) return
    this.preferences = next
    if (!this.loaded) return
    this.dirty = true
    if (this.flushing === undefined) {
      this.flushing = this.flush().finally(() => { this.flushing = undefined })
      void this.flushing.catch(error => {
        console.error('desktop-skins: failed to persist preferences', error)
      })
    }
  }

  private async flush(): Promise<void> {
    await Promise.resolve()
    while (this.dirty) {
      this.dirty = false
      const payload = this.preferences
      const response = await this.request(PREFERENCES_API_PATH, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        throw new Error(`desktop skin preferences save failed (${String(response.status)})`)
      }
    }
  }
}
