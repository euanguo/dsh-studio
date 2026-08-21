import { Slider as SliderPrimitive } from '@base-ui/react/slider'
import type { SliderRootState } from '@base-ui/react/slider'

import { cn } from './cn.ts'

export type SliderProps = SliderPrimitive.Root.Props

/** ShadCN base-nova slider source component with DSW token-backed chrome. */
export function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: SliderProps): JSX.Element {
  const values = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : [value ?? min]
  const rootClassName = typeof className === 'function'
    ? (state: SliderRootState) => cn('dsh-studio-ui-slider', className(state))
    : cn('dsh-studio-ui-slider', className)

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={rootClassName}
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control data-slot="slider-control" className="dsh-studio-ui-slider-control">
        <SliderPrimitive.Track data-slot="slider-track" className="dsh-studio-ui-slider-track">
          <SliderPrimitive.Indicator data-slot="slider-range" className="dsh-studio-ui-slider-range" />
        </SliderPrimitive.Track>
        {Array.from({ length: values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            className="dsh-studio-ui-slider-thumb"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}
