/**
 * Local shim for the official @deepseek-ai/dsh-client-ui-primitives surface
 * consumed by the forked ui-workspace code (the official package is not
 * resolvable in this workspace; its client bundle is not in the runtime
 * module table). Component APIs mirror the official ones; visuals follow the
 * Oh-DSH token ladder.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  IconAdjustments,
  IconArchive,
  IconCheck,
  IconClose,
  IconCopy,
  IconDots,
  IconEdit,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconGitBranch,
  IconPlus,
  IconSearch,
  IconTrash,
  IconTriangle,
} from '../../../../shared/tabler-icons.tsx'

/* ------------------------------ StateDot ------------------------------ */

export type StateDotState = 'done' | 'warning' | 'ongoing' | 'error'

export function StateDot({ state, size = 10, className }: {
  state: StateDotState
  size?: number
  className?: string
}): JSX.Element {
  return (
    <span
      className={`oh-dsh-rail-dot is-${state}${className === undefined ? '' : ` ${className}`}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  )
}

/* ------------------------------ Button ------------------------------ */

export function Button(props: {
  children?: ReactNode
  className?: string | undefined
  disabled?: boolean
  onClick?: () => void
  variant?: 'primary' | 'outline' | 'ghost'
  type?: 'button' | 'submit'
  title?: string
}): JSX.Element {
  const { children, className, variant = 'ghost', ...rest } = props
  return (
    <button
      type="button"
      className={`oh-dsh-rail-button is-${variant}${className === undefined ? '' : ` ${className}`}`}
      {...rest}
    >
      {children}
    </button>
  )
}

/* ------------------------------ Menu ------------------------------ */

export interface MenuEntry {
  id: string
  label?: string
  /** Label rows render as disabled group titles; separators as dividers. */
  type?: 'label' | 'separator'
  text?: string
  icon?: ReactNode
  disabled?: boolean
}

export function Menu(props: {
  open: boolean
  onClose(): void
  items: MenuEntry[]
  selectedIds?: string[]
  onSelect?(id: string): void
  /** Single-selection alias used by the picker surface. */
  selectedId?: string | undefined
  align?: 'start' | 'end'
  dense?: boolean
  portal?: boolean
  closeOnPointerLeave?: boolean
  side?: 'top' | 'right' | 'bottom'
  getAnchorRect?: () => DOMRect | null
  footer?: MenuEntry[] | undefined
  anchor: ReactNode | null
}): JSX.Element {
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!props.open) return
    const close = (event: MouseEvent): void => {
      if (menuRef.current?.contains(event.target as Node)) return
      props.onClose()
    }
    window.addEventListener('mousedown', close, true)
    return () => { window.removeEventListener('mousedown', close, true) }
  }, [props.open, props.onClose])

  const menu = props.open ? (
    <div
      ref={menuRef}
      className={`oh-dsh-rail-menu${props.align === 'end' ? ' is-end' : ''}${props.dense === true ? ' is-dense' : ''}`}
      role="menu"
      onPointerLeave={props.closeOnPointerLeave === true ? () => { props.onClose() } : undefined}
    >
      {props.items.map(item => {
        if (item.type === 'separator') {
          return <div key={item.id} className="oh-dsh-rail-menu-sep" role="separator" />
        }
        if (item.type === 'label') {
          return (
            <div key={item.id} className="oh-dsh-rail-menu-label" role="presentation">
              {item.text ?? ''}
            </div>
          )
        }
        const selected = props.selectedIds?.includes(item.id) === true
          || props.selectedId === item.id
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            aria-checked={selected}
            disabled={item.disabled === true}
            onClick={() => { props.onSelect?.(item.id) }}
          >
            <span className="oh-dsh-rail-menu-check">{selected ? <IconCheck size={12} /> : null}</span>
            {item.icon}
            {item.label ?? item.id}
          </button>
        )
      })}
      {props.footer !== undefined && props.footer.length > 0 && (
        <>
          <div className="oh-dsh-rail-menu-sep" role="separator" />
          {props.footer.map(item => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              onClick={() => { props.onSelect?.(item.id) }}
            >
              <span className="oh-dsh-rail-menu-check" />
              {item.icon}
              {item.label ?? item.id}
            </button>
          ))}
        </>
      )}
    </div>
  ) : null

  if (props.portal === true && menu !== null) {
    return <>{props.anchor}{createPortal(menu, document.body)}</>
  }
  return (
    <>
      {props.anchor}
      {menu}
    </>
  )
}

/* ------------------------------ Modal ------------------------------ */

export function Modal(props: {
  open: boolean
  onClose(): void
  closeLabel?: string
  title?: string
  footer?: ReactNode
  children?: ReactNode
}): JSX.Element | null {
  if (!props.open) return null
  return createPortal(
    <div
      className="oh-dsh-rail-modal-mask"
      onMouseDown={event => {
        if (event.target === event.currentTarget) props.onClose()
      }}
    >
      <div className="oh-dsh-rail-modal" role="dialog" aria-modal="true" aria-label={props.title}>
        <header className="oh-dsh-rail-modal-header">
          <strong>{props.title ?? ''}</strong>
          <button
            type="button"
            aria-label={props.closeLabel ?? 'Close'}
            onClick={props.onClose}
          ><IconClose size={16} /></button>
        </header>
        <div className="oh-dsh-rail-modal-body">{props.children}</div>
        {props.footer !== undefined && (
          <footer className="oh-dsh-rail-modal-footer">{props.footer}</footer>
        )}
      </div>
    </div>,
    document.body,
  )
}

/* ------------------------------ Tooltip ------------------------------ */

export function Tooltip(props: {
  label: string
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  delayMs?: number
  disabled?: boolean
}): JSX.Element {
  const [visible, setVisible] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  return (
    <span
      className="oh-dsh-rail-tooltip-host"
      onMouseEnter={() => {
        if (props.disabled === true) return
        timer.current = window.setTimeout(() => { setVisible(true) }, props.delayMs ?? 300)
      }}
      onMouseLeave={() => {
        window.clearTimeout(timer.current)
        setVisible(false)
      }}
    >
      {props.children}
      {visible && (
        <span className={`oh-dsh-rail-tooltip is-${props.side ?? 'top'}`} role="tooltip">
          {props.label}
        </span>
      )}
    </span>
  )
}

/* ------------------------------ HoverCard ------------------------------ */

export function HoverCard(props: {
  anchor: ReactNode
  content: ReactNode
  disabled?: boolean
  copyText?: string | undefined
  copyLabel?: string
  copiedLabel?: string
}): JSX.Element {
  const [visible, setVisible] = useState(false)
  const [copied, setCopied] = useState(false)
  return (
    <span
      className="oh-dsh-rail-tooltip-host"
      onMouseEnter={() => {
        if (props.disabled === true) return
        setVisible(true)
      }}
      onMouseLeave={() => { setVisible(false) }}
    >
      {props.anchor}
      {visible && (
        <span className="oh-dsh-rail-hovercard" role="tooltip">
          {props.content}
          {props.copyText !== undefined && (
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(props.copyText ?? '')
                setCopied(true)
                window.setTimeout(() => { setCopied(false) }, 1200)
              }}
            >
              {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
              {copied ? (props.copiedLabel ?? 'Copied') : (props.copyLabel ?? 'Copy')}
            </button>
          )}
        </span>
      )}
    </span>
  )
}

/* ------------------------------ Icons ------------------------------ */

type IconProps = { size?: number; className?: string; style?: CSSProperties }

const svg = (path: ReactNode, viewBox = '0 0 24 24') =>
  function Icon({ size = 16, className, style }: IconProps): JSX.Element {
    return (
      <svg
        viewBox={viewBox}
        width={size}
        height={size}
        className={className}
        style={style}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {path}
      </svg>
    )
  }

export const IconCloseFill14 = (p: IconProps) => <IconClose size={14} {...p} />
export const IconPersonalizationOutline16 = (p: IconProps) => <IconAdjustments size={16} {...p} />
export const IconProjectAddOutline16 = (p: IconProps) => <IconFolderPlus size={16} {...p} />
export const IconSearchOutline16 = (p: IconProps) => <IconSearch size={16} {...p} />
export const IconArchiveOutline20 = (p: IconProps) => <IconArchive size={20} {...p} />
export const IconBranchOutline16 = (p: IconProps) => <IconGitBranch size={16} {...p} />
export const IconEditOutline16 = (p: IconProps) => <IconEdit size={16} {...p} />
export const IconEllipsisOutline16 = (p: IconProps) => <IconDots size={16} {...p} />
export const IconFolderClose16 = (p: IconProps) => <IconFolder size={16} {...p} />
export const IconFolderOpen16 = (p: IconProps) => <IconFolderOpen size={16} {...p} />
export const IconPlusOutline16 = (p: IconProps) => <IconPlus size={16} {...p} />
export const IconTrashOutline16 = (p: IconProps) => <IconTrash size={16} {...p} />
export const IconTriangleRightFill14 = (p: IconProps) => <IconTriangle size={14} {...p} />
