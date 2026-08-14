/**
 * Shared inline SVG icon set for the Oh-DSH desktop plugins.
 *
 * WHY inline SVG instead of text glyphs: the DSH official icon library
 * (@deepseek-ai/dsh-client-ui-primitives, 71 × ic_ds_* components) exists,
 * but it is bundled into the official web-app client and is NOT exposed in
 * the staged runtime's client module table — desktop plugins cannot import
 * it without forking the harness source. So all plugin chrome uses one
 * shared, uniform inline set here (same pattern as ToolIcon/PanelIcon).
 * If DSH ever publishes the icon package as an injectable module, swap the
 * components in this file for the official ones — the props stay
 * `{ size, className }` and `fill/stroke = currentColor`.
 */
import type { ReactNode } from 'react'

interface IconProps {
  size?: number
  className?: string
}

function StrokeIcon({
  size = 16,
  className,
  children,
}: {
  size?: number | undefined
  className?: string | undefined
  children: ReactNode
}): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** chevron-down (terminal expand, fact row disclosure) */
export function IconChevronDown({ size, className }: IconProps): JSX.Element {
  return (
    <StrokeIcon size={size} className={className}>
      <path d="M4 6l4 4 4-4" />
    </StrokeIcon>
  )
}

/** chevron-up (terminal collapse) */
export function IconChevronUp({ size, className }: IconProps): JSX.Element {
  return (
    <StrokeIcon size={size} className={className}>
      <path d="M4 10l4-4 4 4" />
    </StrokeIcon>
  )
}

/** close (×) */
export function IconClose({ size, className }: IconProps): JSX.Element {
  return (
    <StrokeIcon size={size} className={className}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </StrokeIcon>
  )
}

/** plus (+) */
export function IconPlus({ size, className }: IconProps): JSX.Element {
  return (
    <StrokeIcon size={size} className={className}>
      <path d="M8 3.5v9M3.5 8h9" />
    </StrokeIcon>
  )
}

/** minus (−) */
export function IconMinus({ size, className }: IconProps): JSX.Element {
  return (
    <StrokeIcon size={size} className={className}>
      <path d="M3.5 8h9" />
    </StrokeIcon>
  )
}

/** arrow-left (back ‹) */
export function IconArrowLeft({ size, className }: IconProps): JSX.Element {
  return (
    <StrokeIcon size={size} className={className}>
      <path d="M10 3.5L5.5 8l4.5 4.5" />
    </StrokeIcon>
  )
}

/** refresh (↻) */
export function IconRefresh({ size, className }: IconProps): JSX.Element {
  return (
    <StrokeIcon size={size} className={className}>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M13.5 2.5V5h-2.5" />
    </StrokeIcon>
  )
}

/** history / clock (◷) */
export function IconHistory({ size, className }: IconProps): JSX.Element {
  return (
    <StrokeIcon size={size} className={className}>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 5v3.5l2.5 1.5" />
    </StrokeIcon>
  )
}

/** box / cube (▣, ▱) */
export function IconBox({ size, className }: IconProps): JSX.Element {
  return (
    <StrokeIcon size={size} className={className}>
      <path d="M8 1.75l5.5 3.125v6.25L8 14.25l-5.5-3.125v-6.25L8 1.75z" />
      <path d="M2.5 4.875L8 8l5.5-3.125M8 8v6.25" />
    </StrokeIcon>
  )
}

/** git branch (⑂) */
export function IconBranch({ size, className }: IconProps): JSX.Element {
  return (
    <StrokeIcon size={size} className={className}>
      <circle cx="5" cy="4" r="1.75" />
      <circle cx="5" cy="12" r="1.75" />
      <circle cx="11.5" cy="7" r="1.75" />
      <path d="M5 5.75v4.5M5 9.5c0 2 6.5 2 6.5-.25V8.75" />
    </StrokeIcon>
  )
}

/** terminal prompt (›_) */
export function IconPrompt({ size, className }: IconProps): JSX.Element {
  return (
    <StrokeIcon size={size} className={className}>
      <path d="M4.5 5.5L7 8l-2.5 2.5M8.5 10.5H12" />
    </StrokeIcon>
  )
}

/** commit marker (—◯—) */
export function IconCommit({ size, className }: IconProps): JSX.Element {
  return (
    <StrokeIcon size={size} className={className}>
      <circle cx="8" cy="8" r="1.75" />
      <path d="M1.5 8h4.75M9.75 8h4.75" />
    </StrokeIcon>
  )
}

/** expand to full window (four corner arrows) */
export function IconExpand({ size, className }: IconProps): JSX.Element {
  return (
    <StrokeIcon size={size} className={className}>
      <path d="M6.5 3.5H3.5v3M9.5 3.5h3v3M12.5 12.5h-3v3M3.5 12.5v3h3" />
    </StrokeIcon>
  )
}

/** restore from full window (overlapping squares) */
export function IconRestore({ size, className }: IconProps): JSX.Element {
  return (
    <StrokeIcon size={size} className={className}>
      <rect x="3.5" y="5.5" width="7" height="7" rx="1" />
      <path d="M6.5 3.5h6a1 1 0 0 1 1 1v6" />
    </StrokeIcon>
  )
}
