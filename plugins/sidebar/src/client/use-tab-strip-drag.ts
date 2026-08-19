/**
 * Shared HTML5 tab-drag state machine for all tab strips (Right, Bottom, Center).
 */
import { useCallback, useEffect, useRef, useState, type DragEvent as ReactDragEvent } from 'react'
import {
  tabDropSideOf,
  type TabDropSide,
} from './tab-drag.ts'
import type { SidebarTabDragPayload } from './contract.ts'
import { poseRoundedTabDragImage } from '@dsh-studio/shared/tab-drag-image'

export const TAB_DRAG_MIME = 'application/x-dsh-studio-tab'

export function serializeTabDrag(payload: SidebarTabDragPayload): string {
  return JSON.stringify(payload)
}

export function parseTabDrag(raw: string | undefined): SidebarTabDragPayload | null {
  if (raw === undefined) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return null
    const value = parsed as Partial<SidebarTabDragPayload>
    if (value.kind !== 'sidebar-tab' || typeof value.tabId !== 'string') return null
    const source = value.source
    if (source !== 'side' && source !== 'bottom' && source !== 'center') return null
    return { kind: 'sidebar-tab', tabId: value.tabId, source }
  } catch {
    return null
  }
}

export interface TabDropMarker {
  id: string
  side: TabDropSide
}

export interface TabDragChip {
  handlers: {
    draggable: boolean
    onDragStart(event: ReactDragEvent<HTMLDivElement>, id: string, label?: string): void
    onDragEnter(event: ReactDragEvent<HTMLDivElement>, id: string): void
    onDragOver(event: ReactDragEvent<HTMLDivElement>, id: string): void
    onDrop(event: ReactDragEvent<HTMLDivElement>, id: string): void
    onDragEnd(event: ReactDragEvent<HTMLDivElement>): void
  }
  markerClass(id: string): string | undefined
}

export interface TabDragStrip {
  marker: TabDropMarker | null
  dragging: boolean
  handlers: {
    onDragOver(event: ReactDragEvent<HTMLDivElement>): void
    onDrop(event: ReactDragEvent<HTMLDivElement>): void
    onDragLeave(event: ReactDragEvent<HTMLDivElement>): void
  }
}

export function useTabStripDrag(opts: {
  source?: 'side' | 'bottom' | 'center'
  onDrop(payload: SidebarTabDragPayload, hoverId: string, side: TabDropSide, event: ReactDragEvent<HTMLDivElement>): void
}): { chip: TabDragChip; strip: TabDragStrip } {
  const source = opts.source ?? 'side'
  const [marker, setMarker] = useState<TabDropMarker | null>(null)
  const [dragging, setDragging] = useState(false)
  const disposeImageRef = useRef<(() => void) | null>(null)

  const clear = useCallback((): void => {
    setMarker(null)
    setDragging(false)
    disposeImageRef.current?.()
    disposeImageRef.current = null
  }, [])

  const handleChipDragStart = useCallback((event: ReactDragEvent<HTMLDivElement>, id: string, label?: string): void => {
    setDragging(true)
    setMarker(null)
    disposeImageRef.current?.()
    disposeImageRef.current = poseRoundedTabDragImage(event, label)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(TAB_DRAG_MIME, serializeTabDrag({
      kind: 'sidebar-tab',
      tabId: id,
      source: source as any,
    }))
  }, [source])

  const acceptDrag = useCallback((event: ReactDragEvent<HTMLElement>): boolean => {
    if (!event.dataTransfer.types.includes(TAB_DRAG_MIME)) return false
    event.preventDefault()
    return true
  }, [])

  const handleChipDragEnter = useCallback((event: ReactDragEvent<HTMLDivElement>, id: string): void => {
    if (!acceptDrag(event)) return
    setMarker({ id, side: 'before' })
  }, [acceptDrag])

  const handleChipDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>, id: string): void => {
    if (!acceptDrag(event)) return
    const rect = event.currentTarget.getBoundingClientRect()
    const offsetX = event.clientX > 0
      ? event.clientX - rect.left
      : event.nativeEvent.offsetX
    setMarker({ id, side: tabDropSideOf(offsetX, rect.width || event.currentTarget.clientWidth) })
  }, [acceptDrag])

  const handleChipDrop = useCallback((event: ReactDragEvent<HTMLDivElement>, id: string): void => {
    const payload = parseTabDrag(event.dataTransfer.getData(TAB_DRAG_MIME))
    const currentMarker = marker
    setMarker(null)
    if (payload === null) return
    event.preventDefault()
    // Determine drop side accurately: use marker if matched, otherwise calculate from clientX
    const rect = event.currentTarget.getBoundingClientRect()
    const side = currentMarker?.id === id
      ? currentMarker.side
      : (event.clientX < rect.left + rect.width / 2 ? 'before' : 'after')
    // Native Electron dragend can still update React state after this drop
    // handler returns. Defer the state owner one task so its reorder is the
    // final write of the drag lifecycle rather than being overwritten by the
    // source tab's dragend cleanup render.
    window.setTimeout(() => { opts.onDrop(payload, id, side, event) }, 0)
  }, [marker, opts.onDrop])

  const handleStripDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>): void => {
    if (!acceptDrag(event)) return
    if ((event.target as HTMLElement).closest('[data-slot="surface-tab"]') === null) {
      setMarker(null)
    }
  }, [acceptDrag])

  const handleStripDrop = useCallback((event: ReactDragEvent<HTMLDivElement>): void => {
    const payload = parseTabDrag(event.dataTransfer.getData(TAB_DRAG_MIME))
    setMarker(null)
    if (payload === null) return
    event.preventDefault()
    opts.onDrop(payload, '', 'after', event)
  }, [opts.onDrop])

  const handleStripDragLeave = useCallback((event: ReactDragEvent<HTMLDivElement>): void => {
    const related = event.relatedTarget
    // React bubbles child dragleave events to the strip. Keep the drag state
    // while crossing from one tab to another; only clear after leaving the
    // whole strip when the browser provides an external related target.
    if (related instanceof Node && event.currentTarget.contains(related)) return
    if (related !== null) clear()
  }, [clear])

  const handleDragEnd = useCallback((): void => {
    clear()
  }, [clear])

  // Global drag listener to avoid stuck ghost state if user releases outside tabs
  useEffect(() => {
    if (!dragging) return
    const onGlobalDragOver = (e: DragEvent): void => {
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    }
    const onGlobalDropOrEnd = (): void => {
      clear()
    }
    document.addEventListener('dragover', onGlobalDragOver)
    document.addEventListener('drop', onGlobalDropOrEnd)
    document.addEventListener('dragend', onGlobalDropOrEnd)
    return () => {
      document.removeEventListener('dragover', onGlobalDragOver)
      document.removeEventListener('drop', onGlobalDropOrEnd)
      document.removeEventListener('dragend', onGlobalDropOrEnd)
    }
  }, [dragging, clear])

  const markerClass = useCallback((id: string): string | undefined => {
    if (marker === null || marker.id !== id) return undefined
    return `is-drop-${marker.side}`
  }, [marker])

  return {
    chip: {
      handlers: {
        draggable: true,
        onDragStart: handleChipDragStart,
        onDragEnter: handleChipDragEnter,
        onDragOver: handleChipDragOver,
        onDrop: handleChipDrop,
        onDragEnd: handleDragEnd,
      },
      markerClass,
    },
    strip: {
      marker,
      dragging,
      handlers: {
        onDragOver: handleStripDragOver,
        onDrop: handleStripDrop,
        onDragLeave: handleStripDragLeave,
      },
    },
  }
}
