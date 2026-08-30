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
import { persistVia, type PersistViaHandle } from '@dsh-studio/shared/store-persistence'

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
  /** Template-C single-flight flush pump (absorbed from the hand-written
   *  `update`/`flush` pair). `fire()` coalesces writes into one host PUT. */
  private readonly persist: PersistViaHandle

  constructor(request: PreferencesFetch) {
    this.request = request
    this.persist = persistVia<DesktopSkinPreferences>(
      {
        // Pull-driven: `update()` fires after folding each patch. Hydration is
        // owned by the plugin boot (explicit `storage.load()`).
        subscribe: () => () => {},
        snapshot: () => this.preferences,
        apply: () => {},
      },
      {
        backend: {
          load: () => Promise.resolve(this.preferences),
          save: value => {
            this.preferences = Object.freeze(value)
            this.queueFlush()
          },
          flush: () => this.settle(),
        },
        merge: (stored) => stored,
        hydrate: false,
      },
    )
  }

  async load(): Promise<void> {
    // Deliberately unguarded: failures propagate so `loaded` stays false and
    // later writes cannot persist resident defaults over the intact host
    // record. The boot caller already logs and continues.
    const response = await this.request(PREFERENCES_API_PATH)
    if (!response.ok) throw new Error(`desktop skin preferences load failed (${String(response.status)})`)
    const preferences = parseSkinPreferences(await response.json())
    if (preferences === undefined) throw new Error('desktop skin preferences response is invalid')
    this.preferences = preferences
    this.loaded = true
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
    this.persist.fire()
  }

  private queueFlush(): void {
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
      // Clear `dirty` only after a confirmed write: a failed PUT keeps it set
      // so the next flush/mutation retries, instead of silently dropping the
      // pending batch and letting memory diverge from the host.
      const payload = this.preferences
      const response = await this.request(PREFERENCES_API_PATH, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        throw new Error(`desktop skin preferences save failed (${String(response.status)})`)
      }
      if (this.preferences === payload) this.dirty = false
    }
  }
}