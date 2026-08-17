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
 * `application/x-oh-dsh-tab` dataTransfer slot; the drop-position math
 * lives in `tab-drag.ts` (pure, unit-tested).
 */
import {
  useState,
  useSyncExternalStore,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from 'react'
import { SurfaceTab, SurfaceTabStrip } from '@oh-dsh/shared/surface-tab'
import type { Translate } from '@oh-dsh/shared/i18n'
import type { WorkspaceMessage } from './i18n.ts'
import type {
  DesktopSidebarService,
  SidebarRenderProps,
  SidebarSnapshot,
  SidebarTab,
} from './contract.ts'
import {
  parseTabDrag,
  reorderIndexAfterRemoval,
  serializeTabDrag,
  TAB_DRAG_MIME,
  tabDropSideOf,
  type TabDropSide,
} from './tab-drag.ts'

export interface BottomWorkbenchProps {
  sidebar: DesktopSidebarService
  t: Translate<WorkspaceMessage>
}

interface DropMarker {
  id: string
  side: TabDropSide
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
  const [marker, setMarker] = useState<DropMarker | null>(null)
  const [dragging, setDragging] = useState(false)
  const tabs = snapshot.bottomTabs

  const clearMarker = (): void => { setMarker(null) }
  const acceptDrag = (event: ReactDragEvent): boolean => {
    // Allow the drop only when the dataTransfer carries our payload
    // (Chromium exposes types only during dragover).
    if (!event.dataTransfer.types.includes(TAB_DRAG_MIME)) return false
    event.preventDefault()
    return true
  }

  const handleStripDragOver = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (!acceptDrag(event)) return
    // The strip's own background (not a chip): dropping appends.
    if ((event.target as HTMLElement).closest('[data-slot="surface-tab"]') === null) {
      setMarker(null)
    }
  }

  const handleStripDrop = (event: ReactDragEvent<HTMLDivElement>): void => {
    const payload = parseTabDrag(event.dataTransfer.getData(TAB_DRAG_MIME))
    clearMarker()
    if (payload === null) return
    event.preventDefault()
    if (payload.source === 'side') {
      sidebar.moveTabToBottom(payload.tabId)
      return
    }
    // A bottom tab dropped on empty strip space: move it to the end.
    const index = tabs.findIndex(tab => tab.id === payload.tabId)
    if (index === -1 || index === tabs.length - 1) return
    sidebar.moveBottomTab(payload.tabId, tabs.length - 1)
  }

  const handleChipDragOver = (event: ReactDragEvent<HTMLDivElement>, tab: SidebarTab): void => {
    if (!acceptDrag(event)) return
    setMarker({ id: tab.id, side: tabDropSideOf(event.nativeEvent.offsetX, event.currentTarget.clientWidth) })
  }

  const handleChipDrop = (event: ReactDragEvent<HTMLDivElement>, hover: SidebarTab): void => {
    const payload = parseTabDrag(event.dataTransfer.getData(TAB_DRAG_MIME))
    clearMarker()
    if (payload === null) return
    event.preventDefault()
    const markerSide = marker?.id === hover.id ? marker.side : 'before'
    const hoverIndex = tabs.findIndex(tab => tab.id === hover.id)
    if (hoverIndex === -1) return
    const target = markerSide === 'before' ? hoverIndex : hoverIndex + 1
    if (payload.source === 'side') {
      sidebar.moveTabToBottom(payload.tabId, target)
      return
    }
    const from = tabs.findIndex(tab => tab.id === payload.tabId)
    if (from === -1) return
    sidebar.moveBottomTab(payload.tabId, reorderIndexAfterRemoval(from, target))
  }

  const chipFor = (tab: SidebarTab): JSX.Element => {
    const active = tab.id === snapshot.bottomActiveId
    return (
      <SurfaceTab
        key={tab.id}
        label={tab.title}
        title={tab.title}
        active={active}
        badge={tabBadgeFor(sidebar, tab, snapshot)}
        draggable
        {...(marker !== null && marker.id === tab.id
          ? { className: `is-drop-${marker.side}` }
          : {})}
        onDragStart={event => {
          setDragging(true)
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData(TAB_DRAG_MIME, serializeTabDrag({
            kind: 'sidebar-tab',
            tabId: tab.id,
            source: 'bottom',
          }))
        }}
        onDragOver={event => { handleChipDragOver(event, tab) }}
        onDrop={event => { handleChipDrop(event, tab) }}
        onDragEnd={() => {
          setDragging(false)
          clearMarker()
        }}
        onSelect={() => { sidebar.activateBottomTab(tab.id) }}
        onClose={() => { sidebar.closeBottomTab(tab.id) }}
        closeLabel={t('side.close-named-tab', { title: tab.title })}
      />
    )
  }

  if (tabs.length === 0) {
    return (
      <section
        className="oh-dsh-bottom-workbench is-empty"
        data-oh-dsh-bottom-workbench=""
        aria-label={t('bottom-workbench.title')}
        onDragOver={handleStripDragOver}
        onDrop={handleStripDrop}
        onDragLeave={clearMarker}
      >
        <span>{t('bottom-workbench.empty')}</span>
      </section>
    )
  }

  const activeTab = tabs.find(tab => tab.id === snapshot.bottomActiveId) ?? tabs[0]!
  const descriptor = sidebar.getTab(activeTab.type)
  const body = descriptor?.render === undefined ? null : (
    <div className="oh-dsh-bottom-workbench-body" key={activeTab.id}>
      {descriptor.render(renderPropsOf(sidebar, activeTab, snapshot.scope))}
    </div>
  )

  return (
    <section
      className="oh-dsh-bottom-workbench"
      data-oh-dsh-bottom-workbench=""
      data-dragging={dragging || undefined}
      aria-label={t('bottom-workbench.title')}
      onDragOver={handleStripDragOver}
      onDrop={handleStripDrop}
      onDragLeave={clearMarker}
    >
      <SurfaceTabStrip aria-label={t('bottom-workbench.tabs')} className="oh-dsh-bottom-workbench-strip">
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
    return <span className="oh-dsh-surface-tab-badge" aria-hidden="true">{label}</span>
  } catch {
    return null
  }
}