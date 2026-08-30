/** Side tools menu rows: one descriptor entry with its icon and hint. */
import { ToolIcon, type ToolIconKind } from '@dsh-studio/shared/tool-icon'
import type { SidebarRailSpec, SidebarSurfaceDescriptor } from './contract.ts'
import { SidebarSurfaceCss as surfaceCss } from './styles.js'

/** Tab descriptor icon size (px). */
export const DESCRIPTOR_ICON_SIZE = 21

function defaultIcon(id: string): ToolIconKind {
  if (id === 'review' || id === 'terminal' || id === 'browser'
    || id === 'files' || id === 'trajectory' || id === 'subagent') return id
  if (id === 'side-chat') return 'chat'
  return 'file'
}

function railTitle(rail: SidebarRailSpec): string {
  return typeof rail.title === 'function' ? rail.title() : rail.title
}

function DescriptorIcon({ descriptor }: {
  descriptor: SidebarSurfaceDescriptor
}): JSX.Element {
  const icon = descriptor.rail?.icon
  const resolved = typeof icon === 'function'
    ? icon(DESCRIPTOR_ICON_SIZE)
    : icon
  return <>{resolved ?? <ToolIcon kind={defaultIcon(descriptor.kind)} />}</>
}

export function ToolRow(props: {
  descriptor: SidebarSurfaceDescriptor
  disabled?: boolean
  disabledTitle?: string
  onClick(): void
}): JSX.Element {
  const rail = props.descriptor.rail
  return (
    <button
      className={surfaceCss["dsh-studio-side-tool-row"]}
      type="button"
      disabled={props.disabled}
      title={props.disabledTitle}
      aria-disabled={props.disabled || undefined}
      onClick={props.onClick}
    >
      <DescriptorIcon descriptor={props.descriptor} />
      <span>{rail === undefined ? props.descriptor.kind : railTitle(rail)}</span>
      {rail?.shortcut !== undefined && <kbd>{rail.shortcut}</kbd>}
    </button>
  )
}
