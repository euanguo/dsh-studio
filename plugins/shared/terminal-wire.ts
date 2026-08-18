/**
 * Versioned terminal output/control wire facts shared by the browser socket
 * and the host batcher. The payload remains JSON for compatibility with the
 * existing `/sidebar/ws/terminal` endpoint; the sequence/epoch fields make
 * flow control and stale-ACK rejection explicit.
 */

export interface TerminalOutputFrame {
  type: 'output'
  epoch: string
  sequence: number
  bytes: number
  data: string
  /** True only for the first snapshot frame after attach/reconnect. */
  replay?: boolean
}

export interface TerminalOutputAck {
  type: 'ack'
  epoch: string
  sequence: number
  bytes: number
}
