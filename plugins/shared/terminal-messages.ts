import type { LocaleMessages } from './i18n.ts'

/**
 * Terminal copy used by both the terminal provider and sidebar surfaces.
 * Keeping this small shared slice here avoids a runtime dependency between
 * feature plugins while preserving one source for the shared strings.
 */
const en = {
  terminal: 'Terminal',
  'terminal.process-exited': 'process exited with code {code}',
  'terminal.error': 'terminal error: {message}',
  'terminal.unknown': 'unknown',
}

type TerminalSidebarSharedKey = keyof typeof en

const zh = {
  terminal: '终端',
  'terminal.process-exited': '进程已退出，代码 {code}',
  'terminal.error': '终端错误：{message}',
  'terminal.unknown': '未知',
} satisfies Record<TerminalSidebarSharedKey, string>

export type { TerminalSidebarSharedKey }

export const TERMINAL_SIDEBAR_SHARED_MESSAGES = {
  en,
  zh,
} satisfies LocaleMessages<TerminalSidebarSharedKey>

export const TERMINAL_SIDEBAR_SHARED_KEYS = Object.keys(en) as TerminalSidebarSharedKey[]
