import type { ITheme } from '@xterm/xterm'

const TOKENS = {
  // The screen canvas follows its host surface through the bridge variable
  // (rail fill in the right rail, layered base in the center). resolveTerminal
  // Theme() reads the computed value from the terminal's own container, so
  // the var() substitution is already resolved by the browser.
  background: '--dsh-studio-terminal-backdrop',
  foreground: '--dsw-alias-label-primary',
  cursor: '--dsw-alias-label-primary',
  selectionBackground: '--dsw-alias-interactive-bg-active',
  selectionForeground: '--dsw-alias-label-primary-inverted',
  // xterm 6.1 renders its own DOM scrollbar; the slider colors come from the
  // theme (JS-injected), so bind them to the same scrollbar token chain as
  // the rest of the surface chrome. The overview ruler border (enabled with
  // scrollbar.width) is hidden to avoid an extra hairline beside the bar.
  scrollbarSliderBackground: '--dsw-alias-scrollbar-bg-l1',
  scrollbarSliderHoverBackground: '--dsw-alias-scrollbar-hover-l1',
  scrollbarSliderActiveBackground: '--dsw-alias-scrollbar-hover-l1',
  overviewRulerBorder: 'transparent',
} as const

const FALLBACK = {
  background: '#ffffff',
  foreground: '#1f2328',
  cursor: '#1f2328',
  selectionBackground: '#d0d7de',
  selectionForeground: '#1f2328',
  scrollbarSliderBackground: 'rgb(0 0 0 / 20%)',
  scrollbarSliderHoverBackground: 'rgb(0 0 0 / 40%)',
  scrollbarSliderActiveBackground: 'rgb(0 0 0 / 50%)',
  overviewRulerBorder: 'transparent',
}

const DARK_ANSI = {
  black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510',
  blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
  brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b', brightYellow: '#f5f543',
  brightBlue: '#3b8eea', brightMagenta: '#d670d6', brightCyan: '#29b8db', brightWhite: '#ffffff',
}

const LIGHT_ANSI = {
  black: '#24292f', red: '#cf222e', green: '#116329', yellow: '#4d2d00',
  blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781',
  brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#1a7f37', brightYellow: '#633c01',
  brightBlue: '#218bff', brightMagenta: '#bf3989', brightCyan: '#3192aa', brightWhite: '#afb8c1',
}

function colorValue(token: string, fallback: string, source: Element): string {
  const value = getComputedStyle(source).getPropertyValue(token).trim()
  return value || fallback
}

function luminance(color: string): number | null {
  const rgb = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(color)
  if (rgb !== null) return 0.2126 * Number(rgb[1]) + 0.7152 * Number(rgb[2]) + 0.0722 * Number(rgb[3])
  const hex = /^#([0-9a-f]{6})$/i.exec(color)
  if (hex === null) return null
  const value = hex[1] as string
  return 0.2126 * Number.parseInt(value.slice(0, 2), 16)
    + 0.7152 * Number.parseInt(value.slice(2, 4), 16)
    + 0.0722 * Number.parseInt(value.slice(4, 6), 16)
}

/**
 * Resolve the xterm theme from a host element's computed surface.
 * @param source - the element whose surface the terminal renders on (the
 * terminal's own container); defaults to `document.body` for callers that
 * resolve before a container exists, which reads the root bridge default.
 */
export function resolveTerminalTheme(source: Element = document.body): ITheme {
  const theme: Record<string, string> = {}
  for (const [role, token] of Object.entries(TOKENS)) {
    theme[role] = colorValue(token, FALLBACK[role as keyof typeof FALLBACK], source)
  }
  return {
    ...theme,
    ...(luminance(theme.background ?? '') !== null && (luminance(theme.background ?? '') as number) > 140
      ? LIGHT_ANSI
      : DARK_ANSI),
  }
}