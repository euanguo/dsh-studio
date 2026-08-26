/**
 * Declarative settings rows for the Side card section: switch and input
 * rows bound to host prefs or plugin settings blobs (split from
 * settings.tsx).
 */
import { useRef, useState } from 'react'
import {
  Button,
  Input,
  Menu,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { IconChevronDown } from '@dsh-studio/shared/tabler-icons'
import { SettingsRow, Switch } from '@dsh-studio/shared/ui'
import type { SidebarSettingToggle } from './contract.ts'
import { SidebarSurfaceCss as surfaceCss } from './styles.js'

export function sidebarLabel(value: string | (() => string)): string {
  return typeof value === 'function' ? value() : value
}

function clampNumber(value: number, min?: number, max?: number): number {
  let next = value
  if (min !== undefined && next < min) next = min
  if (max !== undefined && next > max) next = max
  return next
}

export function SwitchRow(props: {
  title: string
  desc?: string
  checked: boolean
  disabled?: boolean
  onChange(checked: boolean): void
}): JSX.Element {
  return (
    <SettingsRow
      title={props.title}
      {...(props.desc === undefined ? {} : { description: props.desc })}
      control={(
        <Switch
          checked={props.checked}
          disabled={props.disabled ?? false}
          aria-label={props.desc ?? props.title}
          onCheckedChange={props.onChange}
        />
      )}
    />
  )
}

/** One choice from a fixed set, rendered as an official outline Button that
 *  opens a portaled Menu (the same span-anchored pattern as the Source
 *  Control AI model/reasoning rows). The official Button does not forward
 *  refs, so the span owns the anchor rect. */
export function MenuRow(props: {
  title: string
  desc?: string
  value: string
  options: ReadonlyArray<{ id: string; label: string }>
  disabled?: boolean
  onChange(id: string): void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const current = props.options.find(option => option.id === props.value)
  const items: MenuEntry[] = props.options.map(option => ({
    id: option.id,
    label: option.label,
  }))
  return (
    <SettingsRow
      title={props.title}
      {...(props.desc === undefined ? {} : { description: props.desc })}
      control={(
        <span ref={anchorRef} className={surfaceCss["dsh-studio-sidebar-settings-menu-anchor"]}>
          <Button
            variant="outline"
            size="sm"
            disabled={props.disabled ?? false}
            aria-label={props.title}
            aria-expanded={open}
            onClick={() => { setOpen(currentOpen => !currentOpen) }}
          >
            <span className={surfaceCss["dsh-studio-sidebar-settings-menu-label"]}>
              {current?.label ?? props.value}
            </span>
            <IconChevronDown size={14} />
          </Button>
          <Menu
            open={open && (props.disabled ?? false) === false}
            anchor={null}
            portal
            getAnchorRect={() => anchorRef.current?.getBoundingClientRect() ?? null}
            items={items}
            selectedId={props.value}
            onSelect={id => {
              setOpen(false)
              props.onChange(id)
            }}
            onClose={() => { setOpen(false) }}
          />
        </span>
      )}
    />
  )
}

export function InputRow(props: {
  title: string
  desc?: string
  type: 'text' | 'number'
  value: unknown
  min?: number
  max?: number
  placeholder?: string
  unit?: string
  onCommit(value: string | number): void
}): JSX.Element {
  const [draft, setDraft] = useState<string>(
    props.value === undefined ? '' : String(props.value),
  )
  const commit = (): void => {
    const value = props.type === 'number'
      ? clampNumber(Number(draft), props.min, props.max)
      : draft
    if (props.type === 'number' && !Number.isFinite(value)) return
    setDraft(String(value))
    props.onCommit(value)
  }
  return (
    <SettingsRow
      title={props.title}
      {...(props.desc === undefined ? {} : { description: props.desc })}
      control={(
        <span className={surfaceCss["dsh-studio-sidebar-settings-input"]}>
          <Input
            type={props.type}
            value={draft}
            min={props.min}
            max={props.max}
            placeholder={props.placeholder}
            onChange={event => { setDraft(event.currentTarget.value) }}
            onBlur={commit}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                ;(event.target as HTMLInputElement).blur()
              }
              if (event.key === 'Escape') {
                setDraft(props.value === undefined ? '' : String(props.value))
                ;(event.target as HTMLInputElement).blur()
              }
            }}
          />
          {props.unit !== undefined && <span className={surfaceCss["dsh-studio-sidebar-settings-unit"]}>{props.unit}</span>}
        </span>
      )}
    />
  )
}

export function renderToggleRow(props: {
  toggle: SidebarSettingToggle
  value: unknown
  onCommit(value: string | number | boolean): void
}): JSX.Element {
  const { toggle, value, onCommit } = props
  const title = sidebarLabel(toggle.title)
  const desc = toggle.desc === undefined ? undefined : sidebarLabel(toggle.desc)
  if (toggle.type === 'text' || toggle.type === 'number') {
    return (
      <InputRow
        title={title}
        {...(desc === undefined ? {} : { desc })}
        type={toggle.type}
        value={value}
        {...(toggle.min === undefined ? {} : { min: toggle.min })}
        {...(toggle.max === undefined ? {} : { max: toggle.max })}
        {...(toggle.placeholder === undefined ? {} : { placeholder: toggle.placeholder })}
        {...(toggle.unit === undefined ? {} : { unit: toggle.unit })}
        onCommit={next => { onCommit(next) }}
      />
    )
  }
  return (
    <SwitchRow
      title={title}
      {...(desc === undefined ? {} : { desc })}
      checked={value === true}
      onChange={checked => { onCommit(checked) }}
    />
  )
}