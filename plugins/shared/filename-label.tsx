/**
 * Single-line filename with Codex-style middle ellipsis.
 * Ported from the reference project's `components/filename-label.tsx`.
 * One text node (no base/extension flex children) so no gap can appear
 * between name and suffix; extension is prefer-kept when space is tight.
 */
import { useLayoutEffect, useMemo, useState } from 'react'
import { ListRowLabel } from './list-row.tsx'
import { splitFilenameDisplayParts } from './filename-display.ts'
import {
  measureTextWidth,
  middleTruncateFilename,
  readElementTextFont,
} from './middle-truncate-text.ts'

export type FilenameLabelProps = Readonly<{
  name: string
  /** Full path or name for native tooltip. */
  title?: string
  className?: string
}>

export function FilenameLabel({ name, title, className }: FilenameLabelProps): JSX.Element {
  const [host, setHost] = useState<HTMLSpanElement | null>(null)
  const [maxWidthPx, setMaxWidthPx] = useState(0)
  const [font, setFont] = useState('')

  useLayoutEffect(() => {
    if (host === null) return

    const update = (): void => {
      setFont(readElementTextFont(host))
      setMaxWidthPx(host.clientWidth)
    }

    update()

    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      update()
    })
    observer.observe(host)
    return () => {
      observer.disconnect()
    }
  }, [host])

  const { extension } = splitFilenameDisplayParts(name)

  const displayed = useMemo(() => {
    if (maxWidthPx <= 0 || font.length === 0) {
      return name
    }
    const measure = (value: string): number => measureTextWidth(value, font)
    return middleTruncateFilename(name, maxWidthPx, measure, extension)
  }, [extension, font, maxWidthPx, name])

  return (
    <ListRowLabel className={className} title={title ?? name}>
      <span ref={setHost} className="oh-dsh-filename-label-text">
        {displayed}
      </span>
    </ListRowLabel>
  )
}
