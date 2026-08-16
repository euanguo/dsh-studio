export const DESKTOP_SKIN_IDS = [
  'oh-dsh-skin-deep-current',
  'oh-dsh-skin-jade-circuit',
  'oh-dsh-skin-porcelain',
  'oh-dsh-skin-ember-dusk',
  'oh-dsh-skin-synara-night',
  'oh-dsh-skin-synara-day',
  'oh-dsh-skin-chatgpt-night',
  'oh-dsh-skin-chatgpt-day',
] as const

export type DesktopSkinId = typeof DESKTOP_SKIN_IDS[number]
export type DesktopFallbackTheme = 'light' | 'dark' | 'system'

export interface DesktopSkinPreferences {
  activeId: DesktopSkinId | null
  fallbackTheme: DesktopFallbackTheme
}

export const ACTIVE_SKIN_KEY = 'oh-dsh-desktop.skins.active'
export const FALLBACK_THEME_KEY = 'oh-dsh-desktop.skins.fallback'
export const PREFERENCES_API_PATH = '/oh-dsh-desktop/skins/preferences'
export const DEFAULT_SKIN_PREFERENCES: DesktopSkinPreferences = Object.freeze({
  activeId: null,
  fallbackTheme: 'system',
})

export function isDesktopSkinId(value: unknown): value is DesktopSkinId {
  return typeof value === 'string'
    && (DESKTOP_SKIN_IDS as readonly string[]).includes(value)
}

export function isFallbackTheme(value: unknown): value is DesktopFallbackTheme {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function parseSkinPreferences(value: unknown): DesktopSkinPreferences | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const input = value as Record<string, unknown>
  if (input.activeId !== null && !isDesktopSkinId(input.activeId)) return undefined
  if (!isFallbackTheme(input.fallbackTheme)) return undefined
  return Object.freeze({
    activeId: input.activeId,
    fallbackTheme: input.fallbackTheme,
  }) as DesktopSkinPreferences
}
