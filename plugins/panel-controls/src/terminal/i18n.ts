import type { LocaleMessages } from '@dsh-studio/shared/i18n'

export type TerminalMessage =
  | 'terminal'
  | 'terminal.resize'
  | 'terminal.tabs'
  | 'terminal.status.exited'
  | 'terminal.status.error'
  | 'terminal.close-tab'
  | 'terminal.new-shell'
  | 'terminal.shell'
  | 'terminal.font'
  | 'terminal.font-settings'
  | 'terminal.expand'
  | 'terminal.collapse'
  | 'terminal.close-settings'
  | 'terminal.font-family'
  | 'terminal.font-size'
  | 'terminal.reset'
  | 'terminal.empty'
  | 'terminal.toggle'
  | 'terminal.process-exited'
  | 'terminal.error'
  | 'terminal.unknown'

export const TERMINAL_MESSAGES: LocaleMessages<TerminalMessage> = {
  en: {
    terminal: 'Terminal',
    'terminal.resize': 'Resize terminal',
    'terminal.tabs': 'Terminal tabs',
    'terminal.status.exited': 'exited',
    'terminal.status.error': 'error',
    'terminal.close-tab': 'Close {tab}',
    'terminal.new-shell': 'New shell',
    'terminal.shell': 'Shell',
    'terminal.font': 'Terminal font',
    'terminal.font-settings': 'Terminal font settings',
    'terminal.expand': 'Expand terminal',
    'terminal.collapse': 'Collapse terminal',
    'terminal.close-settings': 'Close settings',
    'terminal.font-family': 'Font family',
    'terminal.font-size': 'Font size',
    'terminal.reset': 'Reset',
    'terminal.empty': 'No shell is running',
    'terminal.toggle': 'Toggle terminal',
    'terminal.process-exited': 'process exited with code {code}',
    'terminal.error': 'terminal error: {message}',
    'terminal.unknown': 'unknown',
  },
  zh: {
    terminal: '终端',
    'terminal.resize': '调整终端高度',
    'terminal.tabs': '终端标签页',
    'terminal.status.exited': '已退出',
    'terminal.status.error': '错误',
    'terminal.close-tab': '关闭 {tab}',
    'terminal.new-shell': '新建 Shell',
    'terminal.shell': 'Shell',
    'terminal.font': '终端字体',
    'terminal.font-settings': '终端字体设置',
    'terminal.expand': '展开终端',
    'terminal.collapse': '收起终端',
    'terminal.close-settings': '关闭设置',
    'terminal.font-family': '字体',
    'terminal.font-size': '字号',
    'terminal.reset': '重置',
    'terminal.empty': '当前没有运行的 Shell',
    'terminal.toggle': '切换终端',
    'terminal.process-exited': '进程已退出，代码 {code}',
    'terminal.error': '终端错误：{message}',
    'terminal.unknown': '未知',
  },
}
