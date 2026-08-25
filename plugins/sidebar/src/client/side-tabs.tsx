/** Side tools panel tabs: the pinned 文件/Git chips, the extra-tab strip
 *  (with tab drag) and the window-level panel controls. */
import {
  useEffect,
  useRef,
  useSyncExternalStore,
} from 'react'
import type { Translate } from '@dsh-studio/shared/i18n'
import type { DesktopPanels } from '@dsh-studio/panel-controls/client'
import {
  IconMaximize,
  IconRestore,
  IconSidebarRightFilled,
} from '@dsh-studio/shared/tabler-icons'
import { ToolIcon } from '@dsh-studio/shared/tool-icon'
import { SurfaceTab, ToolbarAction } from '@dsh-studio/shared/ui'
import { bindTabStripWheel } from '@dsh-studio/shared/tab-strip-wheel'
import { useTabStripDrag } from './use-tab-strip-drag.ts'
import { binding, formatKeymapHint } from './kit/keymap.ts'
import type {
  CapabilitiesScope,
  DesktopSidebarService,
  SidebarTab,
} from './contract.ts'
import { tabAvailability } from './contract.ts'
import type { WorkspaceMessage } from './i18n.ts'
import { tabBadge, unavailableTitle } from './side-tool-helpers.tsx'
import { SidebarSurfaceCss as surfaceCss } from './styles.js'

/* Pinned panel entries — 文件 (files) and Git (review) stay one click away,
   everything else is added through the [+] menu. Rendered with the shared
   SurfaceTab chip (the same component the center tab strip uses). Without a
   workspace cwd the workspace-bound chips (files / Git) are disabled with a
   hint — they would otherwise open an empty body. */
export function PinnedTabs({ sidebar, t, cwd }: {
  sidebar: DesktopSidebarService
  t: Translate<WorkspaceMessage>
  cwd: string | undefined
}): JSX.Element {
  const snapshot = useSyncExternalStore(sidebar.subscribe, sidebar.getSnapshot)
  const activeType = snapshot.tabs.find(tab => tab.id === snapshot.activeId)?.type ?? null
  const pinnedScope: CapabilitiesScope | null = cwd === undefined ? null : { cwd }
  const filesAvailability = tabAvailability(
    sidebar.getTab('files')!,
    pinnedScope,
    snapshot,
    sidebar.isTabEnabled('files'),
  )
  const reviewAvailability = tabAvailability(
    sidebar.getTab('review')!,
    pinnedScope,
    snapshot,
    sidebar.isTabEnabled('review'),
  )
  const openType = (type: string): void => {
    const existing = snapshot.tabs.find(tab => tab.type === type)
    if (existing !== undefined) {
      sidebar.activateTab(existing.id)
      return
    }
    sidebar.openTab({ type })
  }
  const filesTab = snapshot.tabs.find(tab => tab.type === 'files')
  const reviewTab = snapshot.tabs.find(tab => tab.type === 'review')
  const filesHint = unavailableTitle(filesAvailability, t)
  const reviewHint = unavailableTitle(reviewAvailability, t)
  return (
    <div className={surfaceCss["dsh-studio-side-pinned"]} role="tablist">
      <SurfaceTab
        label={t('files')}
        icon={<ToolIcon kind="files" />}
        active={activeType === 'files'}
        disabled={!filesAvailability.ok}
        {...(filesHint === undefined ? {} : { disabledTitle: filesHint })}
        badge={filesTab === undefined ? null : tabBadge(sidebar, filesTab)}
        onSelect={() => { openType('files') }}
      />
      <SurfaceTab
        label={t('side.git')}
        icon={<ToolIcon kind="review" />}
        active={activeType === 'review'}
        disabled={!reviewAvailability.ok}
        {...(reviewHint === undefined ? {} : { disabledTitle: reviewHint })}
        badge={reviewTab === undefined ? null : tabBadge(sidebar, reviewTab)}
        onSelect={() => { openType('review') }}
      />
    </div>
  )
}

/* Extra open tools (beyond the pinned 文件 / Git entries) as shared
   SurfaceTab chips. The strip hosts the right-rail side of the tab drag:
   chips reorder inside the rail and can be dropped into the bottom
   workbench (or receive docked tabs back). */
const PINNED_TAB_TYPES = new Set(['files', 'review'])

export function TabStrip({ sidebar, t }: {
  sidebar: DesktopSidebarService
  t: Translate<WorkspaceMessage>
}): JSX.Element | null {
  const snapshot = useSyncExternalStore(sidebar.subscribe, sidebar.getSnapshot)
  const stripRef = useRef<HTMLDivElement>(null)
  const tabs = snapshot.tabs.filter(tab => !PINNED_TAB_TYPES.has(tab.type))

  // Shared drag state machine: canvas rounded drag image + ID-based reordering.
  const drag = useTabStripDrag({
    source: 'side',
    onDrop: (payload, hoverId, side) => {
      // // unwired-capability (leaf-R1 ②): the bottom branch is dormant — the
      // // workbench is not mounted, so a docked tab can never be dragged back;
      // // restored to keep the drag state machine complete for R2 wiring.
      if (payload.source === 'bottom') {
        sidebar.undockTabToSide(payload.tabId, hoverId === '' ? null : hoverId, side)
        return
      }
      sidebar.reorderTabs(payload.tabId, hoverId === '' ? null : hoverId, side)
    },
  })

  useEffect(() => {
    // The wheel binding depends on the strip element being in the DOM.
    // When tabs.length is 0 the component returns null before the element
    // mounts, and the []-only effect would never bind after tabs appear.
    // This dependency ensures the effect re-runs when tabs appear (or
    // disappear), binding the wheel handler to the now-mounted strip.
    if (tabs.length === 0) return
    const el = stripRef.current
    if (el === null) return
    // Wheel over the overflowed tab row scrolls it horizontally (the
    // surface-tab strip helper; non-passive so the page does not scroll).
    return bindTabStripWheel(el)
  }, [tabs.length])
  if (tabs.length === 0) return null

  return (
    <div
      ref={stripRef}
      className={surfaceCss["dsh-studio-side-tabs"]}
      role="tablist"
      {...drag.strip.handlers}
    >
      {tabs.map(tab => {
        const dropClass = drag.chip.markerClass(tab.id)
        return (
          <SurfaceTab
            key={tab.id}
            label={tab.title}
            title={tab.title}
            active={tab.id === snapshot.activeId}
            badge={tabBadge(sidebar, tab)}
            {...(dropClass === undefined ? {} : { className: dropClass })}
            draggable={drag.chip.handlers.draggable}
            onDragStart={event => { drag.chip.handlers.onDragStart(event, tab.id, tab.title) }}
            onDragEnter={event => { drag.chip.handlers.onDragEnter(event, tab.id) }}
            onDragOver={event => { drag.chip.handlers.onDragOver(event, tab.id) }}
            onDrop={event => { drag.chip.handlers.onDrop(event, tab.id) }}
            onDragEnd={drag.chip.handlers.onDragEnd}
            onSelect={() => {
              // A drag in progress must not activate chips beneath the pointer.
              if (drag.strip.dragging) return
              sidebar.activateTab(tab.id)
            }}
            onClose={() => { sidebar.closeTab(tab.id) }}
            closeLabel={t('side.close-named-tab', { title: tab.title })}
            tabId={tab.id}
          />
        )
      })}
    </div>
  )
}

/* The window-level panel controls (expand/restore, side-panel toggle) live
   in the panel's top row, flush right. The terminal toggle used to sit here
   and open the bottom-mounted terminal dock; the dock is removed and the
   terminal is now a first-class surface (open it as a right-rail tab or in
   the center through the middle "+" menu). */
export function PanelActions({
  maximized,
  onToggleMaximized,
  onToggleSide,
  open,
  t,
}: {
  maximized: boolean
  onToggleMaximized(): void
  onToggleSide(): void
  open: boolean
  panels: DesktopPanels
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  return (
    <div className={surfaceCss["dsh-studio-side-tabs-actions"]} role="presentation">
      <ToolbarAction
        variant="ghost"
        icon={maximized ? <IconRestore size={16} /> : <IconMaximize size={16} />}
        label={maximized ? t('side.restore') : t('side.expand')}
        pressed={maximized}
        onClick={onToggleMaximized}
      />
      <ToolbarAction
        variant="ghost"
        icon={(
          <span className={surfaceCss["dsh-studio-side-toggle-glyph"]} aria-hidden="true">
            <IconSidebarRightFilled />
          </span>
        )}
        label={`${t('side.title')} (${formatKeymapHint(binding({ mod: true, alt: true, key: 'b' }))})`}
        pressed={open}
        onClick={onToggleSide}
      />
    </div>
  )
}