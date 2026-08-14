/** Minimal clsx substitute for the forked ui-workspace code. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export default cn
