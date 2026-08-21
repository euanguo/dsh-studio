"use client"

import { Switch as SwitchPrimitive } from '@base-ui/react/switch'
import type { SwitchRootState } from '@base-ui/react/switch'

import { cn } from './cn.ts'

export type SwitchProps = SwitchPrimitive.Root.Props & {
  readonly size?: 'sm' | 'default'
}

/** ShadCN base-nova Switch with DSH token-backed styling. */
export function Switch({ className, size = 'default', ...props }: SwitchProps): JSX.Element {
  const rootClassName = typeof className === 'function'
    ? (state: SwitchRootState) => cn('dsh-studio-ui-switch', className(state))
    : cn('dsh-studio-ui-switch', className)

  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={rootClassName}
      {...props}
    >
      <SwitchPrimitive.Thumb data-slot="switch-thumb" className="dsh-studio-ui-switch-thumb" />
    </SwitchPrimitive.Root>
  )
}
