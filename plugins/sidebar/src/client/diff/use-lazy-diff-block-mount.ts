/**
 * Lazy mount/release for one heavy diff block (M7, extracted from the
 * commit surface's CommitFileBlock).
 *
 * The block's details row stays in the DOM, but its heavy DiffViewer body
 * mounts lazily when the row scrolls near the viewport and RELEASES
 * (replaced by a same-height placeholder) when the row scrolls far away —
 * a large commit neither builds every Pierre diff upfront nor keeps every
 * rendered block resident.
 */
import { useEffect, useRef, useState } from 'react'

/** Distance beyond the viewport at which a block pre-mounts. */
const DEFAULT_MOUNT_MARGIN = '320px 0px'
/** Keep-band around the viewport: farther blocks release their body. */
const DEFAULT_KEEP_BAND = '1600px 0px'

export function useLazyDiffBlockMount(options: {
  mountMargin?: string
  keepBand?: string
} = {}) {
  const mountMargin = options.mountMargin ?? DEFAULT_MOUNT_MARGIN
  const keepBand = options.keepBand ?? DEFAULT_KEEP_BAND
  const [mounted, setMounted] = useState(false)
  const [releasedHeight, setReleasedHeight] = useState<number | null>(null)
  const detailsRef = useRef<HTMLDetailsElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const latestHeightRef = useRef<number | null>(null)

  // Mount-on-approach; a released block re-mounts (drops its same-height
  // placeholder) when the user scrolls back into the mount band.
  useEffect(() => {
    if (mounted && releasedHeight === null) return
    const node = detailsRef.current
    if (node === null) return
    if (typeof IntersectionObserver === 'undefined') {
      setMounted(true)
      setReleasedHeight(null)
      return
    }
    const observer = new IntersectionObserver(
      entries => {
        if (!entries.some(entry => entry.isIntersecting)) return
        if (releasedHeight !== null) {
          setReleasedHeight(null)
        } else {
          setMounted(true)
        }
        observer.disconnect()
      },
      { root: null, rootMargin: mountMargin, threshold: 0.01 },
    )
    observer.observe(node)
    return () => { observer.disconnect() }
  }, [mounted, releasedHeight, mountMargin])

  // Track the body height and release the diff body when the block leaves
  // the keep-band; a same-height placeholder holds the scroll position.
  useEffect(() => {
    if (!mounted || releasedHeight !== null) return
    const node = bodyRef.current
    if (node === null) return
    if (typeof IntersectionObserver === 'undefined' || typeof ResizeObserver === 'undefined') {
      return
    }
    const resizeObserver = new ResizeObserver(entries => {
      const height = entries[0]?.contentRect.height
      if (height !== undefined && height > 0) latestHeightRef.current = height
    })
    resizeObserver.observe(node)
    const releaseObserver = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) {
        const height = latestHeightRef.current
        if (height !== null) setReleasedHeight(height)
      }
    }, { root: null, rootMargin: keepBand, threshold: 0 })
    releaseObserver.observe(node)
    return () => {
      resizeObserver.disconnect()
      releaseObserver.disconnect()
    }
  }, [mounted, releasedHeight, keepBand])

  return {
    mounted,
    /** Height the released body placeholder holds to keep scroll position. */
    releasedHeight,
    detailsRef,
    bodyRef,
  }
}
