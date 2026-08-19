import { useState } from 'react'
import {
  IconAdjustments,
  IconFileCode,
  IconFiles,
  IconFolder,
  IconGitBranch,
  IconList,
  IconTerminal,
  IconWorld,
} from '@dsh-studio/shared/tabler-icons'
import type { ProjectIconNode } from './tree.ts'

const BUILTIN_ICONS = {
  adjustments: IconAdjustments,
  code: IconFileCode,
  directory: IconFolder,
  files: IconFiles,
  folder: IconFolder,
  git: IconGitBranch,
  list: IconList,
  project: IconFolder,
  terminal: IconTerminal,
  web: IconWorld,
} as const

type BuiltinName = keyof typeof BUILTIN_ICONS

function isImageValue(value: string): boolean {
  return value.startsWith('data:image/') || value.startsWith('https://')
}

/** Render one validated project-level icon with a deterministic glyph fallback. */
export function ProjectIconGlyph({ icon, size = 16, className }: {
  icon: ProjectIconNode | undefined
  size?: number
  className?: string
}) {
  const [failedValue, setFailedValue] = useState<string | undefined>(undefined)
  const fallbackName: BuiltinName = icon?.fallback === 'directory' ? 'directory' : 'project'
  const value = icon?.value ?? fallbackName
  if (isImageValue(value) && failedValue !== value) {
    return (
      <img
        src={value}
        alt=""
        width={size}
        height={size}
        className={className}
        draggable={false}
        onError={() => { setFailedValue(value) }}
      />
    )
  }
  const Icon = BUILTIN_ICONS[value as BuiltinName] ?? BUILTIN_ICONS[fallbackName]
  return <Icon size={size} className={className} aria-hidden="true" />
}

/** The names exposed by the manual project icon picker. */
export const projectIconChoices: readonly BuiltinName[] = [
  'folder', 'git', 'code', 'terminal', 'files', 'list', 'web', 'adjustments',
]
