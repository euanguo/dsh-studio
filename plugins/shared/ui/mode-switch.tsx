import type { ReactNode } from 'react'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import { Toggle } from '@base-ui/react/toggle'
import { cn } from './cn.ts'

/**
 * Segmented mode switcher for SurfaceToolbar slots (e.g. Markdown
 * Source/Preview). Single-selection always-on group over the Base UI
 * toggle-group primitive; the selected segment reads through
 * `--dsw-alias-*` tokens so themes/skins restyle it without changes here.
 */
export interface ModeSwitchOption<Value extends string> {
  readonly value: Value
  readonly label: string
  readonly icon?: ReactNode
}

export interface ModeSwitchProps<Value extends string> {
  readonly value: Value
  readonly onValueChange: (value: Value) => void
  readonly options: readonly ModeSwitchOption<Value>[]
  /** Accessible name for the group. */
  readonly ariaLabel: string
  readonly className?: string | undefined
}

export function ModeSwitch<Value extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
  className,
}: ModeSwitchProps<Value>): JSX.Element {
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(groupValue: string[]) => {
        // A mode switch is always-on: ignore the "unpress everything" click.
        const next = groupValue.at(-1)
        if (next !== undefined && next !== value) onValueChange(next as Value)
      }}
      aria-label={ariaLabel}
      className={cn('dsh-studio-ui-mode-switch', className)}
    >
      {options.map(option => (
        <Toggle
          key={option.value}
          value={option.value}
          aria-label={option.label}
          className="dsh-studio-ui-mode-switch-option"
        >
          {option.icon}
          <span>{option.label}</span>
        </Toggle>
      ))}
    </ToggleGroup>
  )
}
