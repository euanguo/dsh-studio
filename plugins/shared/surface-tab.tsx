/**
 * Surface tab chip / strip — the shared tab component used by EVERY
 * surface host: the center strip and the right panel's top row.
 * Ported from the reference project's `components/ui/surface-tab.tsx`.
 * Preview tabs render italic titles and can be pinned via double-click.
 */
import type { KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from 'react'
import { useRef } from 'react'
import { IconClose } from './tabler-icons.tsx'

const SURFACE_TAB_ACTION_SELECTOR = '[data-surface-tab-action]'

function isSurfaceTabActionTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(SURFACE_TAB_ACTION_SELECTOR) !== null
}

export type SurfaceTabProps = Readonly<{
  label: string
  active?: boolean
  icon?: ReactNode
  title?: string
  closeLabel?: string
  /** Preview tabs render italic title and can be pinned via double-click. */
  isPreview?: boolean
  onSelect?: () => void
  onClose?: () => void
  onPin?: () => void
  className?: string
}>

export function SurfaceTab({
  label,
  active = false,
  icon,
  title,
  closeLabel,
  isPreview = false,
  onSelect,
  onClose,
  onPin,
  className,
}: SurfaceTabProps): JSX.Element {
  const selectedOnPointerDownRef = useRef(false)
  const canClose = onClose !== undefined
  const resolvedTitle = title ?? label

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (onSelect === undefined || isSurfaceTabActionTarget(event.target)) {
      selectedOnPointerDownRef.current = false
      return
    }
    if (event.pointerType === 'mouse' && event.button !== 0) {
      selectedOnPointerDownRef.current = false
      return
    }
    event.stopPropagation()
    selectedOnPointerDownRef.current = true
    onSelect()
  }

  const handleClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (selectedOnPointerDownRef.current) {
      selectedOnPointerDownRef.current = false
      event.stopPropagation()
      return
    }
    if (onSelect === undefined || isSurfaceTabActionTarget(event.target)) return
    event.stopPropagation()
    onSelect()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (onSelect === undefined || isSurfaceTabActionTarget(event.target)) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    onSelect()
  }

  const handleDoubleClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (onPin === undefined || isSurfaceTabActionTarget(event.target)) return
    event.stopPropagation()
    onPin()
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
      role={onSelect !== undefined ? 'tab' : undefined}
      tabIndex={onSelect !== undefined ? 0 : undefined}
      title={resolvedTitle}
      data-slot="surface-tab"
      data-state={active ? 'active' : 'idle'}
      data-preview={isPreview || undefined}
      aria-selected={onSelect !== undefined ? active : undefined}
      className={`oh-dsh-surface-tab${active ? ' is-active' : ''}${className === undefined ? '' : ` ${className}`}`}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      {icon !== undefined && icon !== null ? (
        <span className="oh-dsh-surface-tab-icon" aria-hidden="true">{icon}</span>
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
}>

/** Horizontal scrolling host for surface tabs. */
export function SurfaceTabStrip({
  children,
  className,
  'aria-label': ariaLabel,
}: SurfaceTabStripProps): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      data-slot="surface-tab-strip"
      className={`oh-dsh-surface-tab-strip${className === undefined ? '' : ` ${className}`}`}
    >
      {children}
    </div>
  )
}
