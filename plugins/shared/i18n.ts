export type DshStudioLocale = 'en' | 'zh'

export interface LocaleSnapshot {
  active: DshStudioLocale
  revision: number
}

export type Translate<Key extends string = string> = (
  key: Key,
  params?: Record<string, unknown>,
) => string

export type LocaleMessages<Key extends string> = Record<
  DshStudioLocale,
  Record<Key, string>
>

/** Narrow face of the native DSH locale service used by DSH Studio plugins. */
export interface LocaleService {
  bind<Key extends string = string>(namespace: string): Translate<Key>
  getSnapshot(): LocaleSnapshot
  register<Key extends string>(
    namespace: string,
    messages: LocaleMessages<Key>,
  ): () => void
  subscribe(listener: () => void): () => void
}

export function localeTag(locale: LocaleService): string {
  return locale.getSnapshot().active === 'zh' ? 'zh-CN' : 'en-US'
}
