/**
 * Terminal replay composition at the host/client transport seam.
 *
 * The order is intentional and mirrors Synara's snapshot contract:
 * sanitized retained history, then mode preamble, then a live screen replay.
 */
export interface TerminalReplaySource {
  replayTranscript: string
  modeReplay: {
    buildPreamble(): string
    buildScreenReplay(): string
  } | null
}

export function buildTerminalReplayPayload(source: TerminalReplaySource): string {
  const preamble = source.modeReplay?.buildPreamble() ?? ''
  const liveReplay = source.modeReplay?.buildScreenReplay() ?? ''
  return `${source.replayTranscript}${preamble}${liveReplay}`
}
