/**
 * Surface tab chip / strip — the shared tab component used by EVERY
 * surface host: the center strip and the right panel's top row.
 * Ported from the reference project's `components/ui/surface-tab.tsx`.
 * Preview tabs render italic titles and can be pinned via double-click.
 */
import type {
  DragEvent as ReactDragEvent,
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
  ReactNode,
} from 'react'
import { useEffect, useRef } from 'react'
import { IconClose } from './tabler-icons.tsx'
import { bindTabStripWheel } from './tab-strip-wheel.ts'

const SURFACE_TAB_ACTION_SELECTOR = '[data-surface-tab-action]'

function isSurfaceTabActionTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(SURFACE_TAB_ACTION_SELECTOR) !== null
}

export type SurfaceTabProps = Readonly<{
  label: string
  active?: boolean
  /** Renders the tab non-interactive and dimmed (aria-disabled), with a
   *  hint tooltip when `disabledTitle` is given. Clicking/activating is a
   *  no-op while disabled. */
  disabled?: boolean
  /** Tooltip shown while disabled (e.g. "requires a workspace"). */
  disabledTitle?: string
  icon?: ReactNode
  /** A small pill rendered next to the icon (counts / status). */
  badge?: ReactNode
  title?: string
  closeLabel?: string
  /** Preview tabs render italic title and can be pinned via double-click. */
  isPreview?: boolean
  onSelect?: () => void
  onClose?: () => void
  onPin?: () => void
  /** Stable DOM identity for diagnostics and automation; not user-visible. */
  tabId?: string
  className?: string
  /* HTML5 drag support (the right rail / bottom workbench reordering and
     cross-pane moves). The center strip passes none of these. */
  draggable?: boolean
  onDragStart?: (event: ReactDragEvent<HTMLDivElement>) => void
  onDragEnter?: (event: ReactDragEvent<HTMLDivElement>) => void
  onDragOver?: (event: ReactDragEvent<HTMLDivElement>) => void
  onDrop?: (event: ReactDragEvent<HTMLDivElement>) => void
  onDragEnd?: (event: ReactDragEvent<HTMLDivElement>) => void
}>

export function SurfaceTab({
  label,
  active = false,
  disabled = false,
  disabledTitle,
  icon,
  badge,
  title,
  closeLabel,
  isPreview = false,
  onSelect,
  onClose,
  onPin,
  tabId,
  className,
  draggable = false,
  onDragStart,
  onDragEnter,
  onDragOver,
  onDrop,
  onDragEnd,
}: SurfaceTabProps): JSX.Element {
  const selectedOnPointerDownRef = useRef(false)
  const canClose = onClose !== undefined && !disabled
  // Disabled tabs are inert: no activation, close, pin or drag.
  const interactive = onSelect !== undefined && !disabled
  const resolvedTitle = disabled && disabledTitle !== undefined
    ? disabledTitle
    : (title ?? label)

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (!interactive || isSurfaceTabActionTarget(event.target)) {
      selectedOnPointerDownRef.current = false
      return
    }
    if (event.pointerType === 'mouse' && event.button !== 0) {
      selectedOnPointerDownRef.current = false
      return
    }
    event.stopPropagation()
    selectedOnPointerDownRef.current = true
    onSelect!()
  }

  const handleClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (selectedOnPointerDownRef.current) {
      selectedOnPointerDownRef.current = false
      event.stopPropagation()
      return
    }
    if (!interactive || isSurfaceTabActionTarget(event.target)) return
    event.stopPropagation()
    onSelect!()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!interactive || isSurfaceTabActionTarget(event.target)) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    onSelect!()
  }

  const handleDoubleClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (onPin === undefined || disabled || isSurfaceTabActionTarget(event.target)) return
    event.stopPropagation()
    onPin()
  }

  const handleDragStart = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (!interactive || onDragStart === undefined) return
    onDragStart(event)
  }

  const handleDragEnter = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (onDragEnter === undefined) return
    onDragEnter(event)
  }

  const handleDragOver = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (onDragOver === undefined) return
    onDragOver(event)
  }

  const handleDrop = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (onDrop === undefined) return
    onDrop(event)
  }

  const handleDragEnd = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (onDragEnd === undefined) return
    onDragEnd(event)
  }

  const closeButton = canClose ? (
    <button
      type="button"
      className="oh-dsh-surface-tab-action"
      data-surface-tab-action=""
      aria-label={closeLabel ?? label}
      title={closeLabel ?? label}
      onClick={event => {
        event.stopPropagation()
        onClose!()
      }}
    ><IconClose size={12} /></button>
  ) : null

  return (
    <div
      role={interactive ? 'tab' : undefined}
      tabIndex={interactive ? 0 : undefined}
      title={resolvedTitle}
      data-slot="surface-tab"
      data-tab-id={tabId}
      data-state={disabled ? 'disabled' : (active ? 'active' : 'idle')}
      data-preview={isPreview || undefined}
      aria-disabled={disabled || undefined}
      aria-selected={interactive ? active : undefined}
      draggable={!disabled && draggable || undefined}
      className={`oh-dsh-surface-tab${active ? ' is-active' : ''}${disabled ? ' is-disabled' : ''}${className === undefined ? '' : ` ${className}`}`}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      onDragStart={handleDragStart}
       onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragEnd={handleDragEnd}
    >
      {icon !== undefined && icon !== null ? (
        <span className="oh-dsh-surface-tab-icon" aria-hidden="true">{icon}</span>
      ) : null}
      {badge !== undefined && badge !== null ? (
        <span className="oh-dsh-surface-tab-badge" aria-hidden="true">{badge}</span>
      ) : null}
      <span className={`oh-dsh-surface-tab-label${isPreview ? ' is-preview' : ''}`}>
        <span className="oh-dsh-surface-tab-text">{label}</span>
      </span>
      {closeButton}
    </div>
  )
}

export type SurfaceTabStripProps = Readonly<{
  children: ReactNode
  className?: string
  'aria-label'?: string
  /* HTML5 drag support (reordering / cross-pane moves). The center strip
     passes reorder-only handlers; the right rail / bottom workbench pass
     the shared useTabStripDrag strip handlers. */
  onDragEnter?: (event: ReactDragEvent<HTMLDivElement>) => void
  onDragOver?: (event: ReactDragEvent<HTMLDivElement>) => void
  onDrop?: (event: ReactDragEvent<HTMLDivElement>) => void
  onDragLeave?: (event: ReactDragEvent<HTMLDivElement>) => void
}>

/** Horizontal scrolling host for surface tabs. */
export function SurfaceTabStrip({
  children,
  className,
  'aria-label': ariaLabel,
  onDragEnter,
  onDragOver,
  onDrop,
  onDragLeave,
}: SurfaceTabStripProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el === null) return
    return bindTabStripWheel(el)
  }, [])
  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={ariaLabel}
      data-slot="surface-tab-strip"
      className={`oh-dsh-surface-tab-strip${className === undefined ? '' : ` ${className}`}`}
      onDragEnter={onDragEnter}
       onDragOver={onDragOver}
      onDrop={onDrop}
      onDragLeave={onDragLeave}
    >
      {children}
    </div>
  )
}
