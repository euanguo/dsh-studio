/**
 * The BOTTOM workbench — the second pane docked above the terminal dock.
 *
 * Tabs from the right rail can be dragged here (a pragmatic "split": the
 * tab content renders in the bottom pane while the rail keeps the rest),
 * reordered inside the strip, and dragged back to the rail. The tab list
 * lives in the sidebar service (`snapshot.bottomTabs` / `bottomActiveId`),
 * persisted per session, so the layout survives reloads.
 *
 * HTML5 drag & drop carries {@link SidebarTabDragPayload} in the
 * `application/x-dsh-studio-tab` dataTransfer slot; the drop-position math
 * lives in `tab-drag.ts` (pure, unit-tested).
 */
import {
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { EmptyState, SurfaceTab, SurfaceTabStrip } from '@dsh-studio/shared/ui'
import type { Translate } from '@dsh-studio/shared/i18n'
import type { WorkspaceMessage } from './i18n.ts'
import type {
  DesktopSidebarService,
  SidebarRenderProps,
  SidebarSnapshot,
  SidebarTab,
} from './contract.ts'
import { useTabStripDrag } from './use-tab-strip-drag.ts'

export interface BottomWorkbenchProps {
  sidebar: DesktopSidebarService
  t: Translate<WorkspaceMessage>
}

/** The descriptor render input of one docked tab (mapped by the workbench). */
function renderPropsOf(
  sidebar: DesktopSidebarService,
  tab: SidebarTab,
  scope: SidebarRenderProps['scope'],
): SidebarRenderProps {
  return {
    active: false,
    close: () => { sidebar.closeBottomTab(tab.id) },
    patch: patch => { sidebar.updateTab(tab.id, patch) },
    scope,
    tab,
  }
}

export function BottomWorkbench({ sidebar, t }: BottomWorkbenchProps): JSX.Element | null {
  const snapshot = useSyncExternalStore(sidebar.subscribe, sidebar.getSnapshot)
  const tabs = snapshot.bottomTabs

  // Shared drag state machine (source: 'bottom'): canvas rounded drag image + ID-based reordering.
  const drag = useTabStripDrag({
    source: 'bottom',
    onDrop: (payload, hoverId, side) => {
      if (payload.source === 'side') {
        sidebar.dockTabToBottom(payload.tabId, hoverId === '' ? null : hoverId, side)
        return
      }
      sidebar.reorderBottomTabs(payload.tabId, hoverId === '' ? null : hoverId, side)
    },
  })

  const chipFor = (tab: SidebarTab): JSX.Element => {
    const active = tab.id === snapshot.bottomActiveId
    const dropClass = drag.chip.markerClass(tab.id)
    return (
      <SurfaceTab
        key={tab.id}
        label={tab.title}
        title={tab.title}
        active={active}
        badge={tabBadgeFor(sidebar, tab, snapshot)}
        {...(dropClass === undefined ? {} : { className: dropClass })}
        draggable={drag.chip.handlers.draggable}
        onDragStart={event => { drag.chip.handlers.onDragStart(event, tab.id, tab.title) }}
        onDragEnter={event => { drag.chip.handlers.onDragEnter(event, tab.id) }}
        onDragOver={event => { drag.chip.handlers.onDragOver(event, tab.id) }}
        onDrop={event => { drag.chip.handlers.onDrop(event, tab.id) }}
        onDragEnd={drag.chip.handlers.onDragEnd}
        onSelect={() => {
          if (drag.strip.dragging) return
          sidebar.activateBottomTab(tab.id)
        }}
        onClose={() => { sidebar.closeBottomTab(tab.id) }}
        closeLabel={t('side.close-named-tab', { title: tab.title })}
        tabId={tab.id}
      />
    )
  }

  if (tabs.length === 0) {
    return (
      <section
        className="dsh-studio-bottom-workbench is-empty"
        data-dsh-studio-bottom-workbench=""
        aria-label={t('bottom-workbench.title')}
        {...drag.strip.handlers}
      >
        <EmptyState layout="centered" title={t('bottom-workbench.empty')} />
      </section>
    )
  }

  const activeTab = tabs.find(tab => tab.id === snapshot.bottomActiveId) ?? tabs[0]!
  const descriptor = sidebar.getTab(activeTab.type)
  const body = descriptor?.render === undefined ? null : (
    <div className="dsh-studio-bottom-workbench-body" key={activeTab.id}>
      {descriptor.render(renderPropsOf(sidebar, activeTab, snapshot.scope))}
    </div>
  )

  return (
    <section
      className="dsh-studio-bottom-workbench"
      data-dsh-studio-bottom-workbench=""
      data-dragging={drag.strip.dragging || undefined}
      aria-label={t('bottom-workbench.title')}
      {...drag.strip.handlers}
    >
      <SurfaceTabStrip aria-label={t('bottom-workbench.tabs')} className="dsh-studio-bottom-workbench-strip">
        {tabs.map(chipFor)}
      </SurfaceTabStrip>
      {body}
    </section>
  )
}

/** The tab badge of one docked tab (a throwing badge is swallowed). */
function tabBadgeFor(
  sidebar: DesktopSidebarService,
  tab: SidebarTab,
  snapshot: SidebarSnapshot,
): ReactNode {
  const descriptor = sidebar.getTab(tab.type)
  if (descriptor?.badge === undefined) return null
  try {
    const value = descriptor.badge(snapshot.scope, snapshot)
    if (value === undefined || value === null) return null
    const label = typeof value === 'number' ? (value > 99 ? '99+' : String(value)) : value
    return <span className="dsh-studio-surface-tab-badge" aria-hidden="true">{label}</span>
  } catch {
    return null
  }
}