export type ClassValue =
  | string
  | false
  | null
  | undefined
  | 0
  | { readonly [key: string]: boolean | null | undefined }
  | ClassValue[]

/** Small class composition helper for the shadcn source convention. */
export function cn(...values: ClassValue[]): string {
  const output: string[] = []
  const append = (value: ClassValue): void => {
    if (typeof value === 'string' && value !== '') {
      output.push(value)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) append(item)
      return
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, enabled] of Object.entries(value)) {
        if (enabled) output.push(key)
      }
    }
  }
  for (const value of values) append(value)
  return output.join(' ')
}

export default cn
