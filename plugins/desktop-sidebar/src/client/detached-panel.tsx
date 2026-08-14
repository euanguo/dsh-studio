/**
 * Detachable global floating panel.
 *
 * A fixed-position overlay window (NOT full-screen) that floats over the
 * whole app: draggable by its header, resizable from the bottom-right
 * corner, closable via the header button or ESC. Used for file previews and
 * diffs instead of showing content inside the side panel.
 *
 * Pluggable by design: self-contained, render-agnostic children, geometry
 * kept in local state (no global store).
 */
import { useEffect, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconClose } from '../../../shared/tabler-icons.tsx'

export interface DetachedPanelGeometry {
  x: number
  y: number
  width: number
  height: number
}

const MIN_WIDTH = 300
const MIN_HEIGHT = 200
const HEADER_DRAG_PADDING = 48

export function DetachedPanel({
  title,
  subtitle,
  closeLabel,
  onClose,
  actions,
  children,
  defaultGeometry,
  className,
}: {
  title: string
  subtitle?: string
  closeLabel?: string
  onClose(): void
  actions?: ReactNode
  children: ReactNode
  defaultGeometry?: Partial<DetachedPanelGeometry>
  className?: string
}): JSX.Element {
  const [geo, setGeo] = useState<DetachedPanelGeometry>(() => {
    const width = defaultGeometry?.width ?? Math.min(620, Math.max(MIN_WIDTH, window.innerWidth - 320))
    const height = defaultGeometry?.height ?? Math.min(520, window.innerHeight - 120)
    const maxX = Math.max(0, window.innerWidth - 80)
    const maxY = Math.max(0, window.innerHeight - 40)
    return {
      x: Math.min(Math.max(0, defaultGeometry?.x ?? window.innerWidth - width - 24), maxX),
      y: Math.min(Math.max(0, defaultGeometry?.y ?? HEADER_DRAG_PADDING), maxY),
      width,
      height,
    }
  })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => { window.removeEventListener('keydown', onKeyDown, true) }
  }, [onClose])

  const beginDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    // Interactive children (buttons/inputs) keep their own pointer handling.
    if ((event.target as HTMLElement).closest('button, input, select, textarea, a, [role="tab"]')) return
    event.preventDefault()
    const startX = event.clientX
    const startY = event.clientY
    const base = { x: geo.x, y: geo.y }
    const move = (moveEvent: PointerEvent): void => {
      const next = {
        x: Math.min(Math.max(0, base.x + moveEvent.clientX - startX), window.innerWidth - 80),
        y: Math.min(Math.max(0, base.y + moveEvent.clientY - startY), window.innerHeight - 40),
      }
      setGeo(current => ({ ...current, ...next }))
    }
    const finish = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const beginResize = (event: ReactPointerEvent<HTMLElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startY = event.clientY
    const base = { width: geo.width, height: geo.height }
    const move = (moveEvent: PointerEvent): void => {
      setGeo(current => ({
        ...current,
        width: Math.max(MIN_WIDTH, base.width + moveEvent.clientX - startX),
        height: Math.max(MIN_HEIGHT, base.height + moveEvent.clientY - startY),
      }))
    }
    const finish = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  // Portaled to <body>: the side panel's transform (slide-in) would
  // otherwise become the containing block of this fixed overlay.
  return createPortal(
    <div
      className={`oh-dsh-detached${className === undefined ? '' : ` ${className}`}`}
      role="dialog"
      aria-label={title}
      style={{
        // CSS min/max keep the panel inside the viewport even when the
        // window was resized after mount (geometry state is the drag base).
        left: `min(max(${geo.x}px, 0px), calc(100vw - 80px))`,
        top: `min(max(${geo.y}px, 0px), calc(100vh - 40px))`,
        width: geo.width,
        height: geo.height,
      }}
    >
      <header className="oh-dsh-detached-header" onPointerDown={beginDrag}>
        <div className="oh-dsh-detached-title">
          <strong title={title}>{title}</strong>
          {subtitle !== undefined && <small>{subtitle}</small>}
        </div>
        <div className="oh-dsh-detached-actions">
          {actions}
          <button
            type="button"
            aria-label={closeLabel ?? 'Close'}
            title={`${closeLabel ?? 'Close'} (Esc)`}
            onClick={onClose}
          ><IconClose size={16} /></button>
        </div>
      </header>
      <div className="oh-dsh-detached-body">{children}</div>
      <div
        className="oh-dsh-detached-resize"
        onPointerDown={beginResize}
        aria-hidden="true"
      />
    </div>,
    document.body,
  )
}
