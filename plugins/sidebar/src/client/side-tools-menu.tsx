/** Side tools panel: the catalog menu, the [+] add-tools dropdown and the
 *  orphaned-tab empty state (split from SideToolsPanel.tsx). */
import { useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  Menu,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { ToolbarAction } from '@dsh-studio/shared/ui'
import type { Translate } from '@dsh-studio/shared/i18n'
import type { DesktopPanels } from '@dsh-studio/panel-controls/client'
import {
  IconClose,
  IconDots,
  IconFolderOpen,
  IconGitBranch,
  IconList,
  IconMessagePlus,
  IconPlus,
  IconTerminal,
  IconWorld,
} from '@dsh-studio/shared/tabler-icons'
import {
  EmptyState,
  ErrorState,
  ScrollArea,
  useMenuAnchor,
} from '@dsh-studio/shared/ui'
import type {
  CapabilitiesScope,
  DesktopSidebarService,
  SidebarTab,
  SidebarTabDescriptor,
} from './contract.ts'
import { tabAvailability } from './contract.ts'
import type { WorkspaceMessage } from './i18n.ts'
import { ToolRow } from './side-tool-row.tsx'
import { unavailableTitle } from './side-tool-helpers.tsx'
import { SidebarSurfaceCss as surfaceCss } from './styles.js'

export interface SideToolsPanelProps {
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

function descriptorTitle(descriptor: SidebarTabDescriptor): string {
  return typeof descriptor.title === 'function'
    ? descriptor.title()
    : descriptor.title
}

export function SideMenu(props: SideToolsPanelProps): JSX.Element {
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
    <ScrollArea className={surfaceCss["dsh-studio-side-menu"]} viewportClassName="dsh-studio-ui-scroll-viewport-inset">
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
        className={surfaceCss["dsh-studio-side-menu-close"]}
        icon={<IconClose size={16} />}
        label={props.t('side.close')}
        onClick={props.onClose}
      />
    </ScrollArea>
  )
}

export function OrphanedTab({ tab, t }: {
  tab: SidebarTab
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  return (
    <EmptyState
      className={surfaceCss["dsh-studio-side-empty"]}
      title={tab.title}
      description={t('side.orphaned-tab')}
      action={<code className="dsh-studio-orphaned-type">{tab.type}</code>}
    />
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
   renders into document.body instead (the shared body > div[role='menu']
   rule lifts it above the sidebar's fixed root). */
export function AddToolsMenu({ sidebar, t }: {
  sidebar: DesktopSidebarService
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const snapshot = useSyncExternalStore(sidebar.subscribe, sidebar.getSnapshot)
  const { open, toggle, anchorRef, getAnchorRect, close } = useMenuAnchor()
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
    <div className={surfaceCss["dsh-studio-add-tools"]}>
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