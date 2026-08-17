/**
 * Pure sandbox decision for one HTML preview surface.
 *
 * The HTML previewer's iframe is sandboxed by default (opaque origin, no
 * GUI access). Two escape hatches exist, each with its own scope:
 * - a GLOBAL switch (`htmlViewerNoSandbox`) that drops the sandbox for
 *   every preview — only for trusted local content, the setting warns;
 * - a per-surface temporary unlock that the preview's status row toggles
 *   (the "解锁/恢复" buttons), which applies to THIS file only and starts
 *   from the `htmlViewerDefaultUnsafe` preference.
 *
 * Staying pure (no React, no DOM) keeps the decision unit-testable.
 */

/**
 * The per-surface user override: `null` = not toggled yet (follow the
 * default), `true`/`false` = the user explicitly unlocked/restored.
 */
export type HtmlSurfaceUnsafeOverride = boolean | null

/**
 * The effective unsandboxed state of one preview surface: the global switch
 * wins unconditionally; otherwise the per-surface override, or the default
 * when the user has not touched the row.
 */
export function resolveHtmlSurfaceUnsafe(
  globalNoSandbox: boolean,
  defaultUnsafe: boolean,
  override: HtmlSurfaceUnsafeOverride,
): boolean {
  if (globalNoSandbox) return true
  return override ?? defaultUnsafe
}

/** The sandbox attribute value for an iframe in the given state: `''` keeps
 *  the opaque-origin sandbox (fully restrictive), `undefined` omits the
 *  attribute entirely (no sandbox — the unsandboxed escape hatch). */
export function htmlIframeSandboxAttribute(unsandboxed: boolean): '' | undefined {
  return unsandboxed ? undefined : ''
}