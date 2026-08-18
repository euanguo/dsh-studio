declare module '@xterm/addon-ligatures/lib/addon-ligatures.js' {
  import type { Terminal } from '@xterm/xterm'

  export class LigaturesAddon {
    activate(terminal: Terminal): void
    dispose(): void
  }
}
