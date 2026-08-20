import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'

export interface ScrollableProps extends HTMLAttributes<HTMLDivElement> {
  /** Which axes scroll. `y` reserves only the vertical scrollbar lane. */
  readonly axis?: 'y' | 'both'
  /** Optional edge fade for full-column scrollers. */
  readonly fade?: 'none' | 'bottom' | 'top'
  /** Fade overlay colour. Defaults to the base surface. */
  readonly fadeColor?: string
  readonly children?: ReactNode
}

export const Scrollable = forwardRef<HTMLDivElement, ScrollableProps>(function Scrollable(
  {
    fade = 'none',
    fadeColor,
    axis = 'y',
    className,
    style,
    children,
    ...props
  },
  ref,
): JSX.Element {
  const fadeClass = fade === 'none'
    ? null
    : (fade === 'bottom'
      ? 'dsh-studio-scrollable-fade dsh-studio-scrollable-fade-bottom'
      : 'dsh-studio-scrollable-fade dsh-studio-scrollable-fade-top')
  const fadeStyle: CSSProperties | undefined = fadeClass !== null && fadeColor !== undefined
    ? ({ '--dsh-studio-scrollable-fade-color': fadeColor } as CSSProperties)
    : undefined
  const axisClass = axis === 'both'
    ? 'dsh-studio-scrollable dsh-studio-scrollable-xy'
    : 'dsh-studio-scrollable'
  return (
    <div
      ref={ref}
      data-slot="dsh-studio-scrollable"
      data-axis={axis}
      className={className === undefined ? axisClass : `${axisClass} ${className}`}
      style={style}
      {...props}
    >
      {children}
      {fadeClass !== null ? <span className={fadeClass} style={fadeStyle} aria-hidden="true" /> : null}
    </div>
  )
})
