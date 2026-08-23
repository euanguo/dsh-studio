import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { CSPProvider } from '@base-ui/react/csp-provider'
import {
  ScrollArea as ScrollAreaPrimitive,
} from '@base-ui/react/scroll-area'
import { cn } from './cn.ts'

/** ShadCN scroll-area source composition with DSW token-backed chrome
 *  (same Root > Viewport + Scrollbar > Thumb wiring as the registry recipe;
 *  behavior is entirely the @base-ui/react primitive). The overlay thumb
 *  hides at rest, shows on hover/scroll/focus, fades out after leave. */

export interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  /** Which axes scroll. Defaults to vertical only. */
  readonly axis?: 'y' | 'both'
  readonly children?: ReactNode
  /** Extra class for the scrolling viewport (rhythm/role classes that own
   *  direct-child selectors must live here, not on the root). */
  readonly viewportClassName?: string | undefined
  /** Attributes forwarded to the scrolling viewport (role, aria-* handlers). */
  readonly viewportProps?: Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'children'> | undefined
  /** Content rendered inside the root but outside the scrolling viewport,
   *  for non-scrolling overlays such as edge fades. */
  readonly overlay?: ReactNode | undefined
}

/** Ref points to the actual scrolling viewport, matching the contract the
 *  former Scrollable wrapper forwarded to its consumers. */
export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(
  function ScrollArea(
    {
      axis = 'y',
      className,
      viewportClassName,
      viewportProps,
      overlay,
      children,
      ...props
    },
    ref,
  ): JSX.Element {
    return (
      <CSPProvider disableStyleElements>
        <ScrollAreaPrimitive.Root
          data-slot="dsh-studio-scroll-area"
          data-axis={axis}
          className={cn('dsh-studio-ui-scroll-area', className)}
          {...props}
        >
          <ScrollAreaPrimitive.Viewport
            {...viewportProps}
            ref={ref}
            className={cn('dsh-studio-ui-scroll-area-viewport', viewportClassName)}
          >
            {children}
          </ScrollAreaPrimitive.Viewport>
          <ScrollAreaPrimitive.Scrollbar
            orientation="vertical"
            className="dsh-studio-ui-scroll-area-scrollbar"
          >
            <ScrollAreaPrimitive.Thumb className="dsh-studio-ui-scroll-area-thumb" />
          </ScrollAreaPrimitive.Scrollbar>
          {axis === 'both' && (
            <ScrollAreaPrimitive.Scrollbar
              orientation="horizontal"
              className="dsh-studio-ui-scroll-area-scrollbar dsh-studio-ui-scroll-area-scrollbar-x"
            >
              <ScrollAreaPrimitive.Thumb className="dsh-studio-ui-scroll-area-thumb" />
            </ScrollAreaPrimitive.Scrollbar>
          )}
          {overlay}
        </ScrollAreaPrimitive.Root>
      </CSPProvider>
    )
  },
)

/** Parts escape hatch for compositions that need custom wiring, mirroring
 *  how shadcn ships its scroll-area building blocks. */
export const ScrollAreaParts = ScrollAreaPrimitive
