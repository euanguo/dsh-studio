import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'

/**
 * Shared open/anchor state for a portaled official `Menu` anchored on a
 * `ToolbarAction` trigger. The same `useState(open)` + `useRef(anchor)` +
 * `getAnchorRect` trio was previously re-implemented at three call sites
 * (SideToolsPanel AddToolsMenu, center-surface-host CenterAddMenu,
 * files-view create menu) — this is the single implementation.
 */
export interface MenuAnchorState {
  open: boolean
  setOpen: Dispatch<SetStateAction<boolean>>
  /** Flip the trigger's open state (a ToolbarAction `onClick`). */
  toggle(): void
  /** Close the menu (a portaled Menu `onClose` / select handler). */
  close(): void
  /** ToolbarAction ref — the anchor whose rect positions the portaled menu. */
  anchorRef: MutableRefObject<HTMLElement | null>
  /** Feed to the official Menu's `getAnchorRect` prop (anchor={null} portal mode). */
  getAnchorRect(): DOMRect | null
}

export function useMenuAnchor(): MenuAnchorState {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLElement | null>(null)
  const getAnchorRect = useCallback(() => anchorRef.current?.getBoundingClientRect() ?? null, [])
  const toggle = useCallback(() => { setOpen(current => !current) }, [])
  const close = useCallback(() => { setOpen(false) }, [])
  return { open, setOpen, toggle, close, anchorRef, getAnchorRect }
}