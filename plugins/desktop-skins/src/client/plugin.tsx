import type { CSSProperties } from 'react'
import { defineStore } from '@deepseek-ai/dsh-client-runtime/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconCheckOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { ensureStyle } from '@dsh-studio/shared/style-injector'
import { ensureSharedUiStyles, SettingsRow } from '@dsh-studio/shared/ui'
import type { LocaleService, Translate } from '@dsh-studio/shared/i18n'
import {
  DESKTOP_SKINS_MESSAGES,
  type DesktopSkinsMessage,
} from './i18n.ts'
import {
  DesktopSkinsController,
  type DesktopSkinsSnapshot,
  type ThemeService,
  type ThemeSnapshot,
} from './skin-controller.ts'
import { SkinDomPresenter } from './skin-dom.ts'
import {
  DesktopSkinPreferencesStorage,
  type PreferencesFetch,
} from './preferences-storage.ts'
import { DESKTOP_SKINS, type DesktopSkin } from './skins.ts'
import { pluginCss as skinPickerSurfaceCss, SkinPickerCss } from './styles.js'

interface BoundSkinActions {
  sync(activeId: string, ready: boolean, revision: number): void
}

interface SkinRowState {
  activeId: string
  ready: boolean
  revision: number
}

interface SkinRowProps {
  setSkin(id: string | null): void
  t: Translate<DesktopSkinsMessage>
  useStore<T>(selector: (state: SkinRowState) => T): T
}

interface SlotsService {
  inject(name: string, register: () => unknown): void
  register(options: {
    id: string
    inject(actions: BoundSkinActions): { setSkin(id: string | null): void }
    locale: string
    name: string
    order: number
    store: unknown
  }, component: (props: SkinRowProps) => JSX.Element): unknown
}

interface ClientContext {
  effect(effect: () => (() => void) | void, label?: string): void
  get(name: string): unknown
  on(event: 'theme/change', listener: (snapshot: ThemeSnapshot) => void): (() => void) | void
  reflect: {
    provide(name: string, value: unknown, options?: unknown): (() => Promise<void> | void) | void
  }
}

interface SkinOption {
  id: string | null
  label: DesktopSkinsMessage
  mode: DesktopSkinsMessage
  preview: string
  accent: string
}

export const inject = ['locale', 'slots', 'theme']

const SETTINGS_NAMESPACE = 'dsh-studio.desktop-skins'

const DEFAULT_OPTION: SkinOption = {
  id: null,
  label: 'skins.name.default',
  mode: 'skins.mode.system',
  preview: 'linear-gradient(135deg, #fafafa 0 49%, #30343b 50% 100%)',
  accent: '#80868f',
}

function optionFor(skin: DesktopSkin): SkinOption {
  return {
    id: skin.id,
    label: skin.label,
    mode: skin.colorScheme === 'light' ? 'skins.mode.light' : 'skins.mode.dark',
    preview: skin.preview,
    accent: skin.accent,
  }
}

const OPTIONS = [DEFAULT_OPTION, ...DESKTOP_SKINS.map(optionFor)]

function SkinSettingsRow({ setSkin, t, useStore }: SkinRowProps): JSX.Element {
  const activeId = useStore(state => state.activeId)
  const ready = useStore(state => state.ready)

  return (
    <SettingsRow
      className={SkinPickerCss["dsh-studio-skin-settings-row"]}
      title={t('skins.title')}
      description={t('skins.description')}
      disabled={!ready}
      control={(
        <div className={SkinPickerCss["dsh-studio-skin-picker"]} data-slot="skin-picker">
          {OPTIONS.map(option => {
            const selected = activeId === (option.id ?? '')
            const previewStyle = {
              '--dsh-studio-skin-preview': option.preview,
              '--dsh-studio-skin-accent': option.accent,
            } as CSSProperties
            return (
              <Button
                key={option.id ?? 'default'}
                variant="outline"
                size="sm"
                type="button"
                className={SkinPickerCss["dsh-studio-skin-option"]}
                data-selected={selected}
                aria-label={`${t(option.label)} · ${t(option.mode)}`}
                aria-pressed={selected}
                disabled={!ready}
                onClick={() => { setSkin(option.id) }}
              >
                <span className={SkinPickerCss["dsh-studio-skin-option-preview"]} style={previewStyle} />
                <span className={SkinPickerCss["dsh-studio-skin-option-meta"]}>
                  <span className={SkinPickerCss["dsh-studio-skin-option-swatch"]} style={previewStyle} />
                  <span className={SkinPickerCss["dsh-studio-skin-option-copy"]}>
                    <span className={SkinPickerCss["dsh-studio-skin-option-name"]}>{t(option.label)}</span>
                    <span className={SkinPickerCss["dsh-studio-skin-option-mode"]}>{t(option.mode)}</span>
                  </span>
                  {selected && (
                    <span className={SkinPickerCss["dsh-studio-skin-option-check"]} title={t('skins.selected')}>
                      <IconCheckOutline16 size={14} />
                    </span>
                  )}
                </span>
              </Button>
            )
          })}
        </div>
      )}
    />
  )
}

function syncActions(
  actions: BoundSkinActions | undefined,
  snapshot: DesktopSkinsSnapshot,
  ready: boolean,
): void {
  actions?.sync(snapshot.activeId ?? '', ready, snapshot.revision)
}

export function apply(ctx: ClientContext): void {
  const locale = ctx.get('locale') as LocaleService
  const slots = ctx.get('slots') as SlotsService
  const theme = ctx.get('theme') as ThemeService

  ctx.effect(
    () => locale.register('dsh-studio.desktop-skins', DESKTOP_SKINS_MESSAGES),
    'dsh-studio: desktop skins dictionaries',
  )

  ctx.effect(
    () => typeof document === 'undefined'
      ? undefined
      : ensureSharedUiStyles('dsh-studio-desktop-skins-shared-ui'),
    'dsh-studio: desktop settings shared UI styles',
  )
  ctx.effect(
    () => typeof document === 'undefined'
      ? undefined
      : ensureStyle('dsh-studio-desktop-skins-picker', skinPickerSurfaceCss),
    'dsh-studio: desktop skin picker styles',
  )

  const storage = typeof fetch === 'undefined'
    ? memoryStorage()
    : new DesktopSkinPreferencesStorage(fetch.bind(globalThis) as PreferencesFetch)
  const controller = new DesktopSkinsController(
    theme,
    storage,
    new SkinDomPresenter(typeof document === 'undefined' ? undefined : document),
  )
  const store = defineStore({
    init: (): SkinRowState => ({ activeId: '', ready: false, revision: -1 }),
    actions: {
      sync: (draft, activeId: string, ready: boolean, revision: number) => {
        if (revision < draft.revision) return
        draft.activeId = activeId
        draft.ready = ready
        draft.revision = revision
      },
    },
  })
  let bound: BoundSkinActions | undefined
  let ready = false

  ctx.effect(() => {
    let disposed = false
    let started = false
    let stopTheme: (() => void) | void
    let stopController: (() => void) | undefined
    let removeService: (() => Promise<void> | void) | void
    const boot = async (): Promise<void> => {
      if (storage instanceof DesktopSkinPreferencesStorage) {
        try {
          await storage.load()
        } catch (error) {
          console.error('desktop-skins: failed to load preferences', error)
        }
      }
      if (disposed) return
      controller.start()
      started = true
      ready = true
      stopTheme = ctx.on('theme/change', snapshot => { controller.adopt(snapshot) })
      stopController = controller.subscribe(() => {
        syncActions(bound, controller.getSnapshot(), true)
      })
      removeService = ctx.reflect.provide('desktopSkins', controller, undefined)
      syncActions(bound, controller.getSnapshot(), true)
    }
    void boot()
    return () => {
      disposed = true
      ready = false
      stopTheme?.()
      stopController?.()
      if (started) controller.dispose()
      void removeService?.()
    }
  }, 'dsh-studio: desktop skins controller')

  slots.inject('settings.general.item', () => slots.register({
    name: 'settings.general.item',
    id: 'dsh-studio-skins',
    order: 20,
    store,
    locale: SETTINGS_NAMESPACE,
    inject: actions => {
      bound = actions
      syncActions(bound, controller.getSnapshot(), ready)
      return { setSkin: id => { if (ready) controller.setSkin(id) } }
    },
  }, SkinSettingsRow))
}

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => { values.clear() },
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
}
