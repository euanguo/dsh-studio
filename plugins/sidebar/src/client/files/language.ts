/**
 * Language detection + text-viewer degradation policy (pure logic).
 *
 * Replaces the old Prism BY_EXT map: detection now delegates to
 * `@pierre/diffs`' Shiki extension table (`getFiletypeFromFileName`) — the
 * same table the File / FileDiff components use — so the meta-strip label
 * always matches the grammar that is actually applied. No Prism, no separate
 * language registry.
 */
import { getFiletypeFromFileName } from '@pierre/diffs'

/** Above this many characters the highlighted path degrades to plain text. */
export const MAX_HIGHLIGHT_CHARS = 250_000
/** Above this many lines the line-number gutter is dropped (Synara policy). */
export const MAX_NUMBERED_LINES = 20_000

/** Shiki language id for a path ('text' when there is no grammar). */
export function languageForPath(path: string): string {
  return getFiletypeFromFileName(path)
}

/** True when the language has no Shiki grammar (render plain text). */
export function isPlainLanguage(language: string): boolean {
  return language === '' || language === 'text'
}

export interface FileViewPolicy {
  /** Shiki language id ('text' for unknown extensions). */
  language: string
  /** Use the Pierre File renderer (worker-pool Shiki + virtualization). */
  pierre: boolean
}

/**
 * Degradation policy shared by the text and markdown-source branches:
 * Pierre File handles known languages up to MAX_HIGHLIGHT_CHARS; unknown
 * languages and oversized files fall back to the plain text renderer.
 */
export function fileViewPolicy(path: string, contentLength: number): FileViewPolicy {
  const language = languageForPath(path)
  return {
    language,
    pierre: !isPlainLanguage(language) && contentLength <= MAX_HIGHLIGHT_CHARS,
  }
}
