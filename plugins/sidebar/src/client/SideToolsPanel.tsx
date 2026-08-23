import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import {
  Input,
  Menu,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@dsh-studio/shared/i18n'
import type { DesktopPanels } from '@dsh-studio/panel-controls/client'
import { IconRestore } from '@dsh-studio/shared/icons'
import {
  FileGlyph,
  IconChevronDown,
  IconChevronRight,
  IconClose,
  IconCopy,
  IconDots,
  IconEdit,
  IconEye,
  IconFilePlus,
  IconFolderOpen,
  IconFolderPlus,
  IconGitBranch,
  IconList,
  IconMaximize,
  IconMessagePlus,
  IconMinus,
  IconPlus,
  IconRefresh,
  IconSidebarRightFilled,
  IconTerminal,
  IconTrash,
  IconWorld,
} from '@dsh-studio/shared/tabler-icons'
import {
  basename,
  dirname,
  isUnderRoot,
  joinPath,
  relativePathOf,
  resolveCapabilitiesPath,
} from '@dsh-studio/shared/path'
import type { WorkspaceFilesResponse, WorkspaceFileEntry, WorkspaceFileKind } from '../protocol.ts'
import { EmptyState, ErrorState, LoadingState, ToolbarAction, useMenuAnchor } from '@dsh-studio/shared/ui'
import {
  sidebarApi,
  mapSidebarFile,
} from './sidebar-api.ts'
import { buildFileRows, type FileRow } from './files/file-tree-model.ts'
import {
  ListRow,
  ListRowActionButton,
  ListRowActions,
  ListRowBody,
  ListRowLeading,
  ListRowMain,
  ListRowTrailing,
} from '@dsh-studio/shared/ui'
import { FilenameLabel } from '@dsh-studio/shared/filename-label'
import { SurfaceTab } from '@dsh-studio/shared/ui'
import { bindTabStripWheel } from '@dsh-studio/shared/tab-strip-wheel'
import { useTabStripDrag } from './use-tab-strip-drag.ts'
import { ScrollArea } from '@dsh-studio/shared/ui'
import { useSidebarChromeStore } from './runtimes/chrome-store.ts'
import { binding, formatKeymapHint } from './kit/keymap.ts'
import { alertDialog, confirmDialog, promptDialog } from './kit/dialog.tsx'
import type {
  DesktopSidebarService,
  SidebarRenderProps,
  CapabilitiesScope,
  SidebarTab,
  SidebarTabAvailability,
  SidebarTabDescriptor,
} from './contract.ts'
import { tabAvailability } from './contract.ts'
import type { ReviewCommentsService } from './review/review-comments.ts'
import type { WorkspaceMessage } from './i18n.ts'

/** Tab descriptor icon size (px). */
const DESCRIPTOR_ICON_SIZE = 21
/** File search debounce (ms) before hitting the runtime. */
const SEARCH_DEBOUNCE_MS = 250
/** File search result rows shown per query. */
const SEARCH_RESULT_LIMIT = 100
/** Bytes sniffed from a file head for viewer detection. */
const VIEWER_SNIFF_BYTES = 512

interface SideToolsPanelProps {
  cwd: string | undefined
  maximized: boolean
  onClose(): void
  /** Live drag preview: fired at most once per frame (rAF-coalesced). */
  onResizePreview(width: number): void
  /** Final width commit; fired once on pointerup / pointercancel. */
  onResize(width: number): void
  onToggleMaximized(): void
  onToggleSide(): void
  open: boolean
  panels: DesktopPanels
  sidebar: DesktopSidebarService
  t: Translate<WorkspaceMessage>
  width: number
}

// The glyph set lives in the shared kit (both the generic rail and the
// desktop add-on render descriptor icons); re-exported here for the
// panel-internal call sites.
export { ToolIcon, type ToolIconKind } from '@dsh-studio/shared/tool-icon'
import { ToolIcon, type ToolIconKind } from '@dsh-studio/shared/tool-icon'

function defaultIcon(id: string): ToolIconKind {
  if (id === 'review' || id === 'terminal' || id === 'browser'
    || id === 'files' || id === 'trajectory' || id === 'subagent') return id
  if (id === 'side-chat') return 'chat'
  return 'file'
}

function descriptorTitle(descriptor: SidebarTabDescriptor): string {
  return typeof descriptor.title === 'function'
    ? descriptor.title()
    : descriptor.title
}

function DescriptorIcon({ descriptor }: {
  descriptor: SidebarTabDescriptor
}): JSX.Element {
  const icon = typeof descriptor.icon === 'function'
    ? descriptor.icon(DESCRIPTOR_ICON_SIZE)
    : descriptor.icon
  return <>{icon ?? <ToolIcon kind={defaultIcon(descriptor.id)} />}</>
}

function ToolRow(props: {
  descriptor: SidebarTabDescriptor
  disabled?: boolean
  disabledTitle?: string
  onClick(): void
}): JSX.Element {
  return (
    <button
      className="dsh-studio-side-tool-row"
      type="button"
      disabled={props.disabled}
      title={props.disabledTitle}
      aria-disabled={props.disabled || undefined}
      onClick={props.onClick}
    >
      <DescriptorIcon descriptor={props.descriptor} />
      <span>{descriptorTitle(props.descriptor)}</span>
      {props.descriptor.shortcut !== undefined && (
        <kbd>{props.descriptor.shortcut}</kbd>
      )}
    </button>
  )
}

/** Map an availability reason to its user-facing disabled hint title. */
function unavailableTitle(reason: SidebarTabAvailability, t: Translate<WorkspaceMessage>): string | undefined {
  if (reason.ok) return undefined
  if (reason.reason === 'no-workspace') return t('side.no-workspace')
  if (reason.reason === 'not-ready') return t('side.not-ready')
  return t('side.tool-disabled')
}

function SideMenu(props: SideToolsPanelProps): JSX.Element {
  const [error, setError] = useState('')
  const open = async (descriptor: SidebarTabDescriptor): Promise<void> => {
    try {
      setError('')
      if (descriptor.action !== undefined && descriptor.render === undefined) {
        await descriptor.action()
        return
      }
      const result = props.sidebar.openTab({ type: descriptor.id })
      if (result.kind === 'limit') throw new Error(props.t('side.tab-limit'))
      if (result.kind === 'disabled') throw new Error(props.t('side.tool-disabled'))
      if (result.kind === 'missing') throw new Error(props.t('side.tool-missing'))
      if (result.kind === 'not-ready') throw new Error(props.t('side.not-ready'))
    } catch (next) {
      setError(next instanceof Error ? next.message : String(next))
    }
  }
  const snapshot = props.sidebar.getSnapshot()
  const scope: CapabilitiesScope | null = props.cwd === undefined
    ? null
    : { cwd: props.cwd }
  const descriptors = props.sidebar.getTabs().filter(descriptor =>
    descriptor.hidden !== true && props.sidebar.isTabEnabled(descriptor.id),
  )
  return (
    <ScrollArea className="dsh-studio-side-menu" viewportClassName="dsh-studio-ui-scroll-viewport-inset">
      {descriptors.map(descriptor => {
        const availability = tabAvailability(descriptor, scope, snapshot, props.sidebar.isTabEnabled(descriptor.id))
        const unavailableArea = unavailableTitle(availability, props.t)
        return (
          <ToolRow
            key={descriptor.id}
            descriptor={descriptor}
            disabled={!availability.ok}
            {...(unavailableArea === undefined ? {} : { disabledTitle: unavailableArea })}
            onClick={() => { void open(descriptor) }}
          />
        )
      })}
      {error !== '' && <ErrorState message={error} />}
      <ToolbarAction
        variant="ghost"
        className="dsh-studio-side-menu-close"
        icon={<IconClose size={16} />}
        label={props.t('side.close')}
        onClick={props.onClose}
      />
    </ScrollArea>
  )
}
function OrphanedTab({ tab, t }: {
  tab: SidebarTab
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  return (
    <EmptyState
      className="dsh-studio-side-empty"
      title={tab.title}
      description={t('side.orphaned-tab')}
      action={<code className="dsh-studio-orphaned-type">{tab.type}</code>}
    />
  )
}

/** The tab-strip badge of one open tab (a throwing badge is swallowed). */
function tabBadge(
  sidebar: DesktopSidebarService,
  tab: SidebarTab,
): ReactNode {
  const descriptor = sidebar.getTab(tab.type)
  if (descriptor?.badge === undefined) return null
  try {
    const value = descriptor.badge(sidebar.getSnapshot().scope, sidebar.getSnapshot())
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

/* Pinned panel entries — 文件 (files) and Git (review) stay one click away,
   everything else is added through the [+] menu. Rendered with the shared
   SurfaceTab chip (the same component the center tab strip uses). Without a
   workspace cwd the workspace-bound chips (files / Git) are disabled with a
   hint — they would otherwise open an empty body. */
function PinnedTabs({ sidebar, t, cwd }: {
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
    <div className="dsh-studio-side-pinned" role="tablist">
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

/* [+] menu rows use the official outline-16 icon set (the same set the left
   rail's picker menu uses); unknown descriptors fall back to the ellipsis. */
const TOOL_MENU_ICONS: Readonly<Record<string, ReactNode>> = {
  browser: <IconWorld />,
  files: <IconFolderOpen />,
  review: <IconGitBranch />,
  'side-chat': <IconMessagePlus />,
  terminal: <IconTerminal />,
  trajectory: <IconList />,
}

/* [+] menu: every enabled tool that is not open yet, as an anchored
   dropdown. Uses the official ui-primitives Menu in PORTAL mode: the panel
   clips absolutely-positioned children (overflow: hidden), so the list
   renders into document.body instead; the shared rule in side-tools.css
   (body > div[role='menu']) lifts it above the sidebar's fixed root. */
function AddToolsMenu({ sidebar, t }: {
  sidebar: DesktopSidebarService
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const snapshot = useSyncExternalStore(sidebar.subscribe, sidebar.getSnapshot)
  const { open, toggle, anchorRef, getAnchorRect } = useMenuAnchor()
  const descriptors = sidebar.getTabs().filter(descriptor =>
    descriptor.hidden !== true
    && sidebar.isTabEnabled(descriptor.id)
    && !snapshot.tabs.some(tab => tab.type === descriptor.id)
  )
  const items: MenuEntry[] = descriptors.length === 0
    ? [{ type: 'label', id: 'no-more-tools', text: t('side.no-more-tools') }]
    : descriptors.map(descriptor => ({
      id: descriptor.id,
      label: descriptorTitle(descriptor),
      icon: TOOL_MENU_ICONS[descriptor.id] ?? <IconDots />,
    }))
  return (
    <div className="dsh-studio-add-tools">
      <ToolbarAction
        ref={anchorRef}
        variant="ghost"
        className="dsh-studio-add-tools-trigger"
        icon={<IconPlus size={14} />}
        label={t('side.add-tool')}
        aria-expanded={open}
        onClick={toggle}
      />
      <Menu
        open={open}
        anchor={null}
        align="end"
        items={items}
        portal
        getAnchorRect={getAnchorRect}
        onSelect={(id) => {
          sidebar.openTab({ type: id })
          close()
        }}
        onClose={close}
      />
    </div>
  )
}

/* Extra open tools (beyond the pinned 文件 / Git entries) as shared
   SurfaceTab chips. The strip hosts the right-rail side of the tab drag:
   chips reorder inside the rail and can be dropped into the bottom
   workbench (or receive docked tabs back). */
const PINNED_TAB_TYPES = new Set(['files', 'review'])

function TabStrip({ sidebar, t }: {
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
      className="dsh-studio-side-tabs"
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
   in the panel's top row, flush right — no floating toolbar. The terminal
   toggle used to sit here and open the bottom-mounted terminal dock; the
   dock is removed and the terminal is now a first-class surface instead:
   open it as a right-rail tab or in the center through the middle "+" menu
   (see builtins/tabs.tsx and center-surface-host.tsx). */
function PanelActions({
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
  // CUT: the terminal toggle (previously `panels.isBottomPanelOpen()` +
  // `panels.toggleBottomPanel()`) — the bottom terminal dock no longer
  // mounts (see plugins/panel-controls).
  return (
    <div className="dsh-studio-side-tabs-actions" role="presentation">
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
          <span className="dsh-studio-side-toggle-glyph" aria-hidden="true">
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

export function SideToolsPanel(props: SideToolsPanelProps): JSX.Element {
  const snapshot = useSyncExternalStore(
    props.sidebar.subscribe,
    props.sidebar.getSnapshot,
  )
  const activeTab = snapshot.tabs.find(tab => tab.id === snapshot.activeId)
  const descriptor = activeTab === undefined
    ? undefined
    : props.sidebar.getTab(activeTab.type)
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
    : descriptor?.render === undefined || renderProps === undefined
      ? <OrphanedTab tab={activeTab} t={props.t} />
      : descriptor.render(renderProps)
  return (
    <aside
      className="dsh-studio-workspace-panel dsh-studio-side-panel"
      data-open={String(props.open)}
      data-maximized={String(props.maximized)}
      aria-hidden={!props.open}
      aria-label={title}
      style={{ width: '100%' }}
    >
      {!props.maximized && (
        <div
          className="dsh-studio-workspace-resize"
          onPointerDown={beginResize}
          aria-hidden="true"
        />
      )}
      <div className="dsh-studio-side-top">
        <PinnedTabs sidebar={props.sidebar} t={props.t} cwd={props.cwd} />
        <TabStrip sidebar={props.sidebar} t={props.t} />
        <AddToolsMenu sidebar={props.sidebar} t={props.t} />
        <PanelActions
          maximized={props.maximized}
          onToggleMaximized={props.onToggleMaximized}
          onToggleSide={props.onToggleSide}
          open={props.open}
          panels={props.panels}
          t={props.t}
        />
      </div>
      {content}
    </aside>
  )
}
