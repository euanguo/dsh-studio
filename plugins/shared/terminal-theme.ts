import type { ITheme } from '@xterm/xterm'

const TOKENS = {
  background: '--dsw-alias-bg-layer-1',
  foreground: '--dsw-alias-label-primary',
  cursor: '--dsw-alias-label-primary',
  selectionBackground: '--dsw-alias-interactive-bg-active',
  selectionForeground: '--dsw-alias-label-primary-inverted',
} as const

const FALLBACK = {
  background: '#ffffff',
  foreground: '#1f2328',
  cursor: '#1f2328',
  selectionBackground: '#d0d7de',
  selectionForeground: '#1f2328',
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

function colorValue(token: string, fallback: string): string {
  const value = getComputedStyle(document.body).getPropertyValue(token).trim()
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

export function resolveTerminalTheme(): ITheme {
  const theme: Record<string, string> = {}
  for (const [role, token] of Object.entries(TOKENS)) {
    theme[role] = colorValue(token, FALLBACK[role as keyof typeof FALLBACK])
  }
  return {
    ...theme,
    ...(luminance(theme.background ?? '') !== null && (luminance(theme.background ?? '') as number) > 140
      ? LIGHT_ANSI
      : DARK_ANSI),
  }
}