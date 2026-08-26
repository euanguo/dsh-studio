/**
 * Side tools panel orchestration: composes the pinned chips, the extra-tab
 * strip, the [+] menu, the catalog menu/row content and the window controls.
 * The panel internals live in focused modules (side-tool-row, side-tools-menu,
 * side-tabs, side-tool-helpers) — this file keeps only the shell and the
 * resize gesture.
 */
import { SidebarSurfaceCss as surfaceCss } from './styles.js'
import {
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import type { Translate } from '@dsh-studio/shared/i18n'
import type { SidebarRenderProps } from './contract.ts'
import type { WorkspaceMessage } from './i18n.ts'
import {
  AddToolsMenu,
  OrphanedTab,
  SideMenu,
  type SideToolsPanelProps,
} from './side-tools-menu.tsx'
import {
  PanelActions,
  PinnedTabs,
  TabStrip,
} from './side-tabs.tsx'

export { ToolIcon, type ToolIconKind } from '@dsh-studio/shared/tool-icon'

export type { SideToolsPanelProps }

/** The glyph set lives in the shared kit (both the generic rail and the
 *  desktop add-on render descriptor icons). */
export function SideToolsPanel(props: SideToolsPanelProps): JSX.Element {
  const snapshot = useSyncExternalStore(
    props.sidebar.subscribe,
    props.sidebar.getSnapshot,
  )
  const activeTab = snapshot.tabs.find(tab => tab.id === snapshot.activeId)
  const rail = activeTab === undefined
    ? undefined
    : props.sidebar.getTab(activeTab.type)?.rail
  const beginResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = props.width
    // Live drags are rAF-coalesced to ONE preview update per frame and the
    // final width is committed only on pointerup/cancel — never per event —
    // keeping every synchronous layout write and React commit off the
    // pointermove hot path (see workspace-tools.previewResizeWidth).
    let rafId = 0
    let lastWidth = startWidth
    let moved = false
    const schedulePreview = (width: number): void => {
      lastWidth = width
      if (rafId !== 0) return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        props.onResizePreview(lastWidth)
      })
    }
    const move = (next: PointerEvent): void => {
      if (next.clientX !== startX) moved = true
      schedulePreview(startWidth + startX - next.clientX)
    }
    const finish = (): void => {
      if (rafId !== 0) {
        cancelAnimationFrame(rafId)
        rafId = 0
      }
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      if (moved) props.onResize(lastWidth)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }
  const title = activeTab?.title ?? props.t('side.title')
  const renderProps: SidebarRenderProps | undefined = activeTab === undefined
    ? undefined
    : {
      active: props.open,
      close: () => { props.sidebar.closeTab(activeTab.id) },
      patch: patch => { props.sidebar.updateTab(activeTab.id, patch) },
      scope: snapshot.scope,
      tab: activeTab,
    }
  const content: ReactNode = activeTab === undefined
    ? <SideMenu {...props} />
    : rail?.render === undefined || renderProps === undefined
      ? <OrphanedTab tab={activeTab} t={props.t} />
      : rail.render(renderProps)
  return (
    <aside
      className={`dsh-studio-workspace-panel ${surfaceCss["dsh-studio-side-panel"]}`}
      data-open={String(props.open)}
      data-maximized={String(props.maximized)}
      aria-hidden={!props.open}
      aria-label={title}
      style={{ width: '100%' }}
    >
      {!props.maximized && (
        <div
          className={surfaceCss["dsh-studio-workspace-resize"]}
          onPointerDown={beginResize}
          aria-hidden="true"
        />
      )}
      <div className={surfaceCss["dsh-studio-side-top"]}>
        <PinnedTabs sidebar={props.sidebar} t={props.t} cwd={props.cwd} />
        <TabStrip sidebar={props.sidebar} t={props.t} />
        <AddToolsMenu sidebar={props.sidebar} t={props.t} />
        <PanelActions
          maximized={props.maximized}
          onToggleMaximized={props.onToggleMaximized}
          onToggleSide={props.onToggleSide}
          open={props.open}
          t={props.t}
        />
      </div>
      {content}
    </aside>
  )
}