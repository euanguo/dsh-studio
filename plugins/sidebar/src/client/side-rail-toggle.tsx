/**
 * The left-rail expand/collapse toggle, shared by every surface that manages
 * the DSH left rail: the center top rail (always) and the right panel top row
 * (while the panel is maximized and the center rail is covered).
 *
 * The toggle drives the upstream button programmatically and tracks the rail
 * state from that same button's aria-label, so one DOM probe serves every
 * surface. All upstream selectors stay in `surfaces/dsh-dom.ts`.
 */
import { useEffect, useState } from 'react'
import { IconSidebarLeftFilled } from '@dsh-studio/shared/tabler-icons'
import { ToolbarAction } from '@dsh-studio/shared/ui'
import { SidebarSurfaceCss as surfaceCss } from './styles.js'
import {
  leftRailToggleButton,
  leftSidebarElement,
  readLeftRailOpen,
} from './surfaces/dsh-dom.ts'

/** The single manager of the DSH left rail. */
export function LeftRailToggle(props: {
  onToggle(): void
  /** Whether the DSH left rail is currently expanded (null = unknown). */
  open: boolean | null
}): JSX.Element {
  const label = props.open === true ? '收起左栏' : '展开左栏'
  return (
    <ToolbarAction
      variant="ghost"
      className={surfaceCss["dsh-studio-left-rail-toggle"]}
      icon={(
        <span className={surfaceCss["dsh-studio-rail-toggle-glyph"]} aria-hidden="true">
          <IconSidebarLeftFilled />
        </span>
      )}
      label={label}
      pressed={props.open === true}
      onClick={props.onToggle}
    />
  )
}

/** Track the DSH left rail open/closed state via its toggle button's
 *  aria-label (flips between 打开侧边栏 / 收起侧边栏). */
export function useLeftRailOpenState(): {
  leftRailOpen: boolean | null
  toggleLeftRail(): void
} {
  const [leftRailOpen, setLeftRailOpen] = useState<boolean | null>(null)
  useEffect(() => {
    const read = (): void => {
      const next = readLeftRailOpen()
      if (next !== null) setLeftRailOpen(next)
    }
    read()
    // Observe only the DSH left sidebar subtree (not the whole body):
    // chat streaming re-renders the conversation constantly, and this
    // state only depends on the sidebar toggle's aria-label.
    const observer = new MutationObserver(read)
    // Reset targets from the dsh-dom probe module so an upstream sidebar-slot
    // rename is re-pinned in one file (C5).
    const sidebarSlot = leftSidebarElement()
    const root = sidebarSlot ?? document.body
    if (root !== null) {
      observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'class'] })
    }
    return () => { observer.disconnect() }
  }, [])
  return {
    leftRailOpen,
    toggleLeftRail: () => {
      leftRailToggleButton()?.click()
    },
  }
}
