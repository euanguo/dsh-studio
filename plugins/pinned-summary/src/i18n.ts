import type { LocaleMessages } from '@dsh-studio/shared/i18n'

export type PinnedSummaryMessage =
  | 'summary.label'
  | 'summary.title'
  | 'summary.close'
  | 'summary.no-active'
  | 'summary.select-session'
  | 'summary.session'
  | 'summary.empty-placeholder'
  | 'summary.source.context'
  | 'summary.source.assistant'
  | 'summary.source.overview'
  | 'summary.status.running'
  | 'summary.status.waiting'
  | 'summary.status.ready'
  | 'summary.updated'
  | 'summary.blank'
  | 'summary.unavailable'

export const PINNED_SUMMARY_MESSAGES: LocaleMessages<PinnedSummaryMessage> = {
  en: {
    'summary.label': 'Pinned Summary',
    'summary.title': 'Pinned Summary',
    'summary.close': 'Close Pinned Summary',
    'summary.no-active': 'No active session',
    'summary.select-session': 'Select a session to see its summary.',
    'summary.session': 'Session',
    'summary.empty-placeholder': 'The active DSH session summary will appear here.',
    'summary.source.context': 'DSH context summary',
    'summary.source.assistant': 'Latest assistant response',
    'summary.source.overview': 'Session overview',
    'summary.status.running': 'Running',
    'summary.status.waiting': 'Waiting for input',
    'summary.status.ready': 'Ready',
    'summary.updated': 'Updated {time}',
    'summary.blank': 'This session has not started yet.',
    'summary.unavailable': 'No DSH compaction summary is available yet. The latest generated summary will be pinned here automatically.',
  },
  zh: {
    'summary.label': '固定摘要',
    'summary.title': '固定摘要',
    'summary.close': '关闭固定摘要',
    'summary.no-active': '没有活动会话',
    'summary.select-session': '选择一个会话查看摘要。',
    'summary.session': '会话',
    'summary.empty-placeholder': '当前 DSH 会话的摘要将显示在这里。',
    'summary.source.context': 'DSH 上下文摘要',
    'summary.source.assistant': '最新助手回复',
    'summary.source.overview': '会话概览',
    'summary.status.running': '运行中',
    'summary.status.waiting': '等待输入',
    'summary.status.ready': '就绪',
    'summary.updated': '更新于 {time}',
    'summary.blank': '该会话尚未开始。',
    'summary.unavailable': '暂无 DSH 压缩摘要。生成后将自动固定在这里。',
  },
}
