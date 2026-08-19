/**
 * Decide how the center surface queue should reflect the current conversation.
 * The policy distinguishes navigation within a project from entering a project
 * whose queue has no restored surface yet.
 */
export type CurrentConversationSyncAction = 'open' | 'activate' | 'none'

/**
 * Resolve the current conversation transition for the center surface host.
 * @param input - current project and conversation transition facts.
 * @returns the queue action required for the current conversation.
 */
export function currentConversationSyncAction(input: {
  cwdChanged: boolean
  current: string | undefined
  previousCurrent: string | undefined
  currentTabOpen: boolean
  openSurfaceCount: number
}): CurrentConversationSyncAction {
  if (input.current === undefined) return 'none'
  if (!input.cwdChanged && input.previousCurrent !== input.current) {
    return input.currentTabOpen ? 'activate' : 'open'
  }
  if (input.cwdChanged && input.openSurfaceCount === 0 && !input.currentTabOpen) {
    return 'open'
  }
  return 'none'
}
