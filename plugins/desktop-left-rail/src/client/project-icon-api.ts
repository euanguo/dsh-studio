import { callSidebarGlobalApi } from '@dsh-studio/shared/sidebar-api'

export type ProjectIconDetection = {
  repoRoot: string
  icon:
    | { kind: 'image'; src: string; source: 'file' | 'favicon' | 'github'; label: string }
    | null
}

/** Detect a project icon through the Host's bounded filesystem/Git probe. */
export function detectProjectIcon(cwd: string, signal?: AbortSignal): Promise<ProjectIconDetection> {
  return callSidebarGlobalApi<ProjectIconDetection>('project.icon-detect', { cwd }, signal)
}
