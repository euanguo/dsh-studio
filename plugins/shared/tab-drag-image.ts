/**
 * Custom tab drag image helper (Canvas-backed for crisp, true rounded borders).
 *
 * Rather than relying on DOM element snapshots which often clip border-radius,
 * drop alpha transparency, or capture sibling flex elements, this utility
 * renders a crisp, high-DPI rounded pill directly onto an off-screen Canvas
 * and passes it to `dataTransfer.setDragImage()`.
 */
import type { DragEvent } from 'react'

export function poseRoundedTabDragImage(
  event: DragEvent<HTMLElement>,
  label?: string,
): () => void {
  const source = event.currentTarget
  const rect = source.getBoundingClientRect()
  const width = Math.max(60, Math.min(220, Math.round(rect.width || 120)))
  const height = Math.max(24, Math.min(36, Math.round(rect.height || 28)))
  const radius = 12.5

  const text = label || source.querySelector('.dsh-studio-surface-tab-text')?.textContent || source.textContent || 'Tab'

  // Use a temporary canvas to generate clean transparent image
  const canvas = document.createElement('canvas')
  const dpr = window.devicePixelRatio || 1
  canvas.width = width * dpr
  canvas.height = height * dpr
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`

  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.scale(dpr, dpr)

    // Draw background rounded pill
    ctx.beginPath()
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(0, 0, width, height, radius)
    } else {
      // Fallback
      ctx.moveTo(radius, 0)
      ctx.lineTo(width - radius, 0)
      ctx.quadraticCurveTo(width, 0, width, radius)
      ctx.lineTo(width, height - radius)
      ctx.quadraticCurveTo(width, height, width - radius, height)
      ctx.lineTo(radius, height)
      ctx.quadraticCurveTo(0, height, 0, height - radius)
      ctx.lineTo(0, radius)
      ctx.quadraticCurveTo(0, 0, radius, 0)
      ctx.closePath()
    }

    // Modern glass/pill styling (dark + light theme resilient).
    // C43: resolve hardcoded drag-image colors from the live DSW tokens via
    // getComputedStyle so theme/skin changes flow through. Canvas fillStyle/
    // strokeStyle cannot consume CSS custom properties directly, so reading
    // the computed value of the semantic alias is the sanctioned path.
    const cs = getComputedStyle(document.body)
    const pillBg = cs.getPropertyValue('--dsw-alias-bg-layer-1').trim()
    const pillBorder = cs.getPropertyValue('--dsw-alias-border-l2').trim()
    const pillText = cs.getPropertyValue('--dsw-alias-label-primary').trim()

    ctx.fillStyle = pillBg || 'rgba(255, 255, 255, 0.92)'
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = pillBorder || 'rgba(0, 0, 0, 0.15)'
    ctx.stroke()

    // Draw label
    const fontFamily = getComputedStyle(document.body).fontFamily
    ctx.font = `500 12px ${fontFamily || 'system-ui'}`
    ctx.fillStyle = pillText || '#1f2328'
    ctx.textBaseline = 'middle'

    const maxTextWidth = width - 24
    let truncated = text
    while (ctx.measureText(truncated).width > maxTextWidth && truncated.length > 1) {
      truncated = truncated.slice(0, -1)
    }
    if (truncated !== text) truncated += '…'

    ctx.fillText(truncated, 12, height / 2)
  }

  // Attach offscreen so browser can use it as drag image
  canvas.style.position = 'fixed'
  canvas.style.top = '-9999px'
  canvas.style.left = '-9999px'
  canvas.style.pointerEvents = 'none'
  document.body.appendChild(canvas)

  const { offsetX, offsetY } = event.nativeEvent
  const clickX = Number.isFinite(offsetX) && offsetX > 0 ? Math.min(offsetX, width / 2) : Math.round(width / 2)
  const clickY = Number.isFinite(offsetY) && offsetY > 0 ? Math.min(offsetY, height / 2) : Math.round(height / 2)

  try {
    event.dataTransfer.setDragImage(canvas, clickX, clickY)
  } catch {
    // Best effort fallback
  }

  return () => {
    if (canvas.parentNode) {
      canvas.parentNode.removeChild(canvas)
    }
  }
}
