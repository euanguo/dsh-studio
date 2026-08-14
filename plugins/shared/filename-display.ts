/**
 * Split a file/folder display name so the UI can keep the extension visible
 * while the base truncates (extension-preserving ellipsis). Ported from the
 * reference project's `shared/filename-display.ts`.
 *
 * Extension is the final `.ext` only when it looks like a real suffix
 * (not dotfiles like `.gitignore`, not trailing dots).
 */

export type FilenameDisplayParts = Readonly<{
  base: string
  extension: string
}>

export function splitFilenameDisplayParts(name: string): FilenameDisplayParts {
  const trimmed = name.trim()
  if (trimmed.length === 0) {
    return { base: name, extension: '' }
  }

  const dotIndex = trimmed.lastIndexOf('.')
  // Dotfile or no extension.
  if (dotIndex <= 0 || dotIndex === trimmed.length - 1) {
    return { base: trimmed, extension: '' }
  }

  const extension = trimmed.slice(dotIndex)
  // Guard absurd "extensions" (paths smuggled into names, very long suffixes).
  if (extension.length > 12 || extension.includes(' ') || extension.includes('/')) {
    return { base: trimmed, extension: '' }
  }

  return {
    base: trimmed.slice(0, dotIndex),
    extension,
  }
}
