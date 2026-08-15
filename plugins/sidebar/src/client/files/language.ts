/**
 * Language detection for the text viewer (pure logic).
 *
 * Detection delegates to `@pierre/diffs`' Shiki extension table
 * (`getFiletypeFromFileName`) — the same table the File / FileDiff
 * components use — so the meta-strip label always matches the grammar
 * that is actually applied. Every plain-text kind renders through the
 * same Pierre File component; unknown languages pass lang 'text'.
 */
import { getFiletypeFromFileName } from '@pierre/diffs'

/** Above this many lines the line-number gutter is dropped (Synara policy). */
export const MAX_NUMBERED_LINES = 20_000

/** Shiki language id for a path ('text' when there is no grammar). */
export function languageForPath(path: string): string {
  return getFiletypeFromFileName(path)
}

/** True when the language has no Shiki grammar (plain rows, no highlight). */
export function isPlainLanguage(language: string): boolean {
  return language === '' || language === 'text'
}
