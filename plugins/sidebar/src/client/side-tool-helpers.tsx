/** Side panel shared helpers (split from SideToolsPanel.tsx). */
import type { ReactNode } from 'react'
import type { Translate } from '@dsh-studio/shared/i18n'
import type {
  DesktopSidebarService,
  SidebarTab,
  SidebarTabAvailability,
} from './contract.ts'
import type { WorkspaceMessage } from './i18n.ts'

/** Map an availability reason to its user-facing disabled hint title. */
export function unavailableTitle(
  reason: SidebarTabAvailability,
  t: Translate<WorkspaceMessage>,
): string | undefined {
  if (reason.ok) return undefined
  if (reason.reason === 'no-workspace') return t('side.no-workspace')
  if (reason.reason === 'not-ready') return t('side.not-ready')
  return t('side.tool-disabled')
}

/** The tab-strip badge of one open tab (a throwing badge is swallowed). */
export function tabBadge(
  sidebar: DesktopSidebarService,
  tab: SidebarTab,
): ReactNode {
  const badge = sidebar.getTab(tab.type)?.rail?.badge
  if (badge === undefined) return null
  try {
    const value = badge(sidebar.getSnapshot().scope, sidebar.getSnapshot())
    if (value === null || value === undefined) return null
    const label = typeof value === 'number'
      ? (value > 99 ? '99+' : String(value))
      : String(value)
    return <span className="dsh-studio-surface-tab-badge" aria-hidden="true">{label}</span>
  } catch (error) {
    console.error('[sidebar] badge error:', error)
    return null
  }
}