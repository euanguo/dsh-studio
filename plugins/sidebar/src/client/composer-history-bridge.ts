// // unwired-capability (leaf-R1 ①): restored adapter between the composer's
// // write path and the history registry. Not called while composer history is
// // dormant; kept functional so re-wiring does not need a redesign.
export interface ComposerHistoryInput {
  setDraft(text: string): void
}
export interface ComposerHistoryContext {
  get(name: string): unknown
}

export interface ComposerHistorySessions {
  scope?(id: string): unknown
}

export interface ComposerHistoryInputTriggers {
  sessionOf?(scope: unknown): {
    menu?: {
      getSnapshot(): { open?: boolean }
    }
  } | undefined
}

interface ConversationInputService {
  input: {
    for(context: unknown): ComposerHistoryInput
  }
}

/** Let an active slash or reference menu retain its own arrow-key handling. */
export function hasOpenComposerTriggerMenu(
  inputTriggers: ComposerHistoryInputTriggers | undefined,
  sessions: ComposerHistorySessions,
  sessionId: string,
): boolean {
  try {
    const scope = sessions.scope?.(sessionId)
    return scope !== undefined && inputTriggers?.sessionOf?.(scope)?.menu?.getSnapshot().open === true
  } catch {
    return false
  }
}

/** Resolve the public composer write path, degrading silently on old runtimes. */
export function composerInputForSession(
  ctx: ComposerHistoryContext,
  sessions: ComposerHistorySessions,
  sessionId: string,
): ComposerHistoryInput | undefined {
  const scope = sessions.scope?.(sessionId)
  if (scope === undefined) return undefined
  try {
    const conversation = ctx.get('conversation') as ConversationInputService | undefined
    return conversation?.input.for(scope)
  } catch {
    return undefined
  }
}
