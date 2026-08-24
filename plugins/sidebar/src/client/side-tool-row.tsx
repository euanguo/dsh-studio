/** Side tools menu rows: one descriptor entry with its icon and hint. */
import { ToolIcon, type ToolIconKind } from '@dsh-studio/shared/tool-icon'
import type { SidebarTabDescriptor } from './contract.ts'
import { SidebarSurfaceCss as surfaceCss } from './styles.js'

/** Tab descriptor icon size (px). */
export const DESCRIPTOR_ICON_SIZE = 21

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

export function ToolRow(props: {
  descriptor: SidebarTabDescriptor
  disabled?: boolean
  disabledTitle?: string
  onClick(): void
}): JSX.Element {
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
      <span>{descriptorTitle(props.descriptor)}</span>
      {props.descriptor.shortcut !== undefined && (
        <kbd>{props.descriptor.shortcut}</kbd>
      )}
    </button>
  )
}