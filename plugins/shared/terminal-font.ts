/**
 * Terminal font family resolver and fallback builder (adapted from Orca's
 * `layout-serialization.ts` and `pane-terminal-options.ts`).
 *
 * Browsers safely skip fonts absent on the host OS. Listing standard system
 * monospaced fonts followed by common Nerd Fonts and symbol fallbacks ensures
 * that Powerline, Oh-My-Zsh / Starship prompt glyphs, git branch icons, and
 * PUA symbols (U+E000–U+F8FF) render properly without breaking monospace cell metrics.
 */

export const DEFAULT_TERMINAL_FONT_FALLBACKS = [
  'ui-monospace',
  'SF Mono',
  'Menlo',
  'Monaco',
  'Cascadia Mono',
  'Consolas',
  'DejaVu Sans Mono',
  'Liberation Mono',
  'Symbols Nerd Font Mono',
  'MesloLGS Nerd Font',
  'JetBrainsMono Nerd Font',
  'FiraCode Nerd Font',
  'Hack Nerd Font',
  'monospace',
] as const

/**
 * Builds a quoted, deduplicated CSS font-family string with full symbol fallbacks.
 * If userFont is specified, it is placed first in the chain.
 */
export function buildTerminalFontFamily(userFont?: string | null): string {
  const trimmed = userFont?.trim() ?? ''
  const parts: string[] = []
  const seen = new Set<string>()

  const addFont = (font: string): void => {
    const raw = font.replace(/^["']|["']$/g, '').trim()
    if (raw === '') return
    const lower = raw.toLowerCase()
    if (seen.has(lower)) return
    seen.add(lower)
    parts.push(raw === 'monospace' || raw === 'ui-monospace' ? raw : `"${raw}"`)
  }

  if (trimmed !== '') {
    // Handle comma-separated custom font strings as well
    for (const piece of trimmed.split(',')) {
      addFont(piece)
    }
  }

  for (const fallback of DEFAULT_TERMINAL_FONT_FALLBACKS) {
    addFont(fallback)
  }

  return parts.join(', ')
}
