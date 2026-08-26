import type { LocaleMessages } from '@dsh-studio/shared/i18n'

export type DesktopSkinsMessage =
  | 'skins.title'
  | 'skins.description'
  | 'skins.name.default'
  | 'skins.name.deep-current'
  | 'skins.name.jade-circuit'
  | 'skins.name.porcelain'
  | 'skins.name.ember-dusk'
  | 'skins.name.synara-night'
  | 'skins.name.synara-day'
  | 'skins.name.chatgpt-night'
  | 'skins.name.chatgpt-day'
  | 'skins.mode.system'
  | 'skins.mode.light'
  | 'skins.mode.dark'
  | 'skins.selected'

export const DESKTOP_SKINS_MESSAGES: LocaleMessages<DesktopSkinsMessage> = {
  en: {
    'skins.title': 'Desktop skin',
    'skins.description': 'Choose a visual skin. Your selection is applied immediately.',
    'skins.name.default': 'Original',
    'skins.name.deep-current': 'Deep Current',
    'skins.name.jade-circuit': 'Jade Circuit',
    'skins.name.porcelain': 'Porcelain',
    'skins.name.ember-dusk': 'Ember Dusk',
    'skins.name.synara-night': 'Synara Night',
    'skins.name.synara-day': 'Synara Day',
    'skins.name.chatgpt-night': 'ChatGPT Night',
    'skins.name.chatgpt-day': 'ChatGPT Day',
    'skins.mode.system': 'Follow appearance',
    'skins.mode.light': 'Light',
    'skins.mode.dark': 'Dark',
    'skins.selected': 'Selected',
  },
  zh: {
    'skins.title': '桌面皮肤',
    'skins.description': '选择视觉皮肤，点击后立即生效。',
    'skins.name.default': '原始外观',
    'skins.name.deep-current': '深海流光',
    'skins.name.jade-circuit': '翡翠回路',
    'skins.name.porcelain': '青白瓷',
    'skins.name.ember-dusk': '余烬暮色',
    'skins.name.synara-night': 'Synara 夜色',
    'skins.name.synara-day': 'Synara 晨曦',
    'skins.name.chatgpt-night': 'ChatGPT 暗夜',
    'skins.name.chatgpt-day': 'ChatGPT 白日',
    'skins.mode.system': '跟随外观设置',
    'skins.mode.light': '浅色',
    'skins.mode.dark': '深色',
    'skins.selected': '已选择',
  },
}
