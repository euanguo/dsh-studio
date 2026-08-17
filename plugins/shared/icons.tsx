/**
 * Glyphs the official `@deepseek-ai/dsh-client-ui-primitives` icon set
 * does not ship. Chrome icons that exist officially are imported from
 * that package at the call site — this file is not an alias layer.
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

/** minus (−) */
export function IconMinus({ size, className }: IconProps): JSX.Element {
  return (
    <StrokeIcon size={size} className={className}>
      <path d="M3.5 8h9" />
    </StrokeIcon>
  )
}

/** history / clock */
export function IconHistory({ size, className }: IconProps): JSX.Element {
  return (
    <StrokeIcon size={size} className={className}>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 5v3.5l2.5 1.5" />
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

/** restore from full window (overlapping squares) */
export function IconRestore({ size, className }: IconProps): JSX.Element {
  return (
    <StrokeIcon size={size} className={className}>
      <rect x="3.5" y="5.5" width="7" height="7" rx="1" />
      <path d="M6.5 3.5h6a1 1 0 0 1 1 1v6" />
    </StrokeIcon>
  )
}

/** eye / preview */
export function IconEye({ size, className }: IconProps): JSX.Element {
  return (
    <StrokeIcon size={size} className={className}>
      <path d="M1.75 8s2.25-4.25 6.25-4.25S14.25 8 14.25 8s-2.25 4.25-6.25 4.25S1.75 8 1.75 8z" />
      <circle cx="8" cy="8" r="1.75" />
    </StrokeIcon>
  )
}

/** file document */
export function IconFile({ size, className }: IconProps): JSX.Element {
  return (
    <StrokeIcon size={size} className={className}>
      <path d="M4.5 2.5h5l3 3V13.5h-8z" />
      <path d="M9.5 2.5v3h3" />
    </StrokeIcon>
  )
}

/** text file */
export function IconFileText({ size, className }: IconProps): JSX.Element {
  return (
    <StrokeIcon size={size} className={className}>
      <path d="M4.5 2.5h5l3 3V13.5h-8z" />
      <path d="M9.5 2.5v3h3M6 8.5h4M6 11h2.5" />
    </StrokeIcon>
  )
}

/** file diff */
export function IconFileDiff({ size, className }: IconProps): JSX.Element {
  return (
    <StrokeIcon size={size} className={className}>
      <path d="M4.5 2.5h5l3 3V13.5h-8z" />
      <path d="M9.5 2.5v3h3M6.5 9h3M8 7.5v3" />
    </StrokeIcon>
  )
}

/** terminal prompt */
export function IconTerminal({ size, className }: IconProps): JSX.Element {
  return (
    <StrokeIcon size={size} className={className}>
      <path d="M4.5 5.5L7 8l-2.5 2.5M8.5 10.5H12" />
    </StrokeIcon>
  )
}

/** stacked list */
export function IconList({ size, className }: IconProps): JSX.Element {
  return (
    <StrokeIcon size={size} className={className}>
      <path d="M3.5 4.5h9M3.5 8h9M3.5 11.5h9" />
    </StrokeIcon>
  )
}

/** flat layout list */
export function IconLayoutList({ size, className }: IconProps): JSX.Element {
  return (
    <StrokeIcon size={size} className={className}>
      <rect x="2.5" y="3.5" width="11" height="3" rx="0.75" />
      <rect x="2.5" y="9.5" width="11" height="3" rx="0.75" />
    </StrokeIcon>
  )
}

/** tree list */
export function IconListTree({ size, className }: IconProps): JSX.Element {
  return (
    <StrokeIcon size={size} className={className}>
      <path d="M3.5 4h4M3.5 8h2.5M8 8h4.5M6 8v4.5H10.5" />
    </StrokeIcon>
  )
}

/**
 * Right-panel toggle: a frame with a filled strip along its RIGHT edge.
 * Official primitives only ship a left-panel glyph.
 */
export function IconSidebarRightFilled({
  size = 16,
  className,
}: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M6 3a3 3 0 0 0 -2.995 2.824l-.005 .176v12a3 3 0 0 0 2.824 2.995l.176 .005h12a3 3 0 0 0 2.995 -2.824l.005 -.176v-12a3 3 0 0 0 -2.824 -2.995l-.176 -.005h-12zm12 2a1 1 0 0 1 .993 .883l.007 .117v12a1 1 0 0 1 -.883 .993l-.117 .007h-3v-14h3z" />
    </svg>
  )
}
