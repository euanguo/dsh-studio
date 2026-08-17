/**
 * Scrollable — a transparent scroll host that guarantees a stable
 * scrollbar lane (content does not shift sideways when the bar appears)
 * and optionally softens the container's top/bottom edges with a fade.
 *
 * This is a layout concern only: the consumer's own class keeps its flex
 * role, width, borders and padding; `Scrollable` provides the scroll
 * behavior — `overflow-y: auto` plus `scrollbar-gutter: stable` — and the
 * optional fade overlays. Because it renders a single element and
 * forwards its ref, it can act as the scroll host for a virtualizer
 * (`getScrollElement`), for direct `scrollTop` driving (diff F7
 * navigation), or for `scrollIntoView` targeting.
 *
 * Fades default to `none`: panel-inner lists (file list, diff stacks,
 * path tree) scroll inside the panel and must not mask content. Only a
 * full-column region that scrolls to the panel rim should opt into a
 * bottom/top fade, and its content needs matching bottom/top padding so
 * the last row clears the gradient.
 */
import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'

export interface ScrollableProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Which axes scroll. `y` (default) reserves only the vertical scrollbar
   * lane — right for row lists. `both` additionally enables horizontal
   * scrolling for wide content (wide images, data tables).
   */
  axis?: 'y' | 'both'
  /**
   * Fade direction. `none` (default) renders no overlay at all so the
   * block matches an ordinary scroller. `bottom` / `top` paint a lenient
   * gradient at that edge; pass `fadeColor` (or set
   * `--oh-dsh-scrollable-fade-color` on a parent) to theme it.
   */
  fade?: 'none' | 'bottom' | 'top'
  /** Fade overlay colour (CSS colour). Defaults to the base surface. */
  fadeColor?: string
  children?: ReactNode
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
  }: ScrollableProps,
  ref,
): JSX.Element {
  const fadeClass = fade === 'none' ? null : (
    fade === 'bottom' ? 'oh-dsh-scrollable-fade oh-dsh-scrollable-fade-bottom'
      : 'oh-dsh-scrollable-fade oh-dsh-scrollable-fade-top'
  )
  const fadeStyle: CSSProperties | undefined =
    fadeClass !== null && fadeColor !== undefined
      ? ({ '--oh-dsh-scrollable-fade-color': fadeColor } as CSSProperties)
      : undefined
  const axisClass = axis === 'both' ? 'oh-dsh-scrollable oh-dsh-scrollable-xy' : 'oh-dsh-scrollable'
  return (
    <div
      ref={ref}
      data-slot="oh-dsh-scrollable"
      data-axis={axis}
      className={className === undefined ? axisClass : `${axisClass} ${className}`}
      style={style}
      {...props}
    >
      {children}
      {fadeClass !== null && <span className={fadeClass} style={fadeStyle} aria-hidden="true" />}
    </div>
  )
})
