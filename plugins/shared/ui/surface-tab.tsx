import type {
  DragEvent as ReactDragEvent,
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
  ReactNode,
} from 'react'
import { useEffect, useRef } from 'react'
import { IconClose } from '../tabler-icons.tsx'
import { bindTabStripWheel } from '../tab-strip-wheel.ts'
import { cn } from './cn.ts'

const SURFACE_TAB_ACTION_SELECTOR = '[data-surface-tab-action]'

function isSurfaceTabActionTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(SURFACE_TAB_ACTION_SELECTOR) !== null
}

export type SurfaceTabProps = Readonly<{
  label: string
  active?: boolean
  disabled?: boolean
  disabledTitle?: string
  icon?: ReactNode
  badge?: ReactNode
  title?: string
  closeLabel?: string
  isPreview?: boolean
  onSelect?: () => void
  onClose?: () => void
  onPin?: () => void
  tabId?: string
  className?: string
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
  const interactive = onSelect !== undefined && !disabled
  const resolvedTitle = disabled && disabledTitle !== undefined ? disabledTitle : (title ?? label)

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
      className={cn('dsh-studio-surface-tab', active && 'is-active', disabled && 'is-disabled', className)}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      onDragStart={event => { if (interactive) onDragStart?.(event) }}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      {icon !== undefined && icon !== null ? <span className="dsh-studio-surface-tab-icon" aria-hidden="true">{icon}</span> : null}
      {badge !== undefined && badge !== null ? <span className="dsh-studio-surface-tab-badge" aria-hidden="true">{badge}</span> : null}
      <span className={cn('dsh-studio-surface-tab-label', isPreview && 'is-preview')}>
        <span className="dsh-studio-surface-tab-text">{label}</span>
      </span>
      {canClose ? (
        <button
          type="button"
          className="dsh-studio-surface-tab-action"
          data-surface-tab-action=""
          aria-label={closeLabel ?? label}
          title={closeLabel ?? label}
          onClick={event => { event.stopPropagation(); onClose!() }}
        >
          <IconClose size={12} />
        </button>
      ) : null}
    </div>
  )
}

export type SurfaceTabStripProps = Readonly<{
  children: ReactNode
  className?: string
  'aria-label'?: string
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
    const element = ref.current
    if (element === null) return
    return bindTabStripWheel(element)
  }, [])
  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={ariaLabel}
      data-slot="surface-tab-strip"
      className={cn('dsh-studio-surface-tab-strip', className)}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragLeave={onDragLeave}
    >
      {children}
    </div>
  )
}
