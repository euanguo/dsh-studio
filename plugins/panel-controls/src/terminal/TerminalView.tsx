/**
 * Re-export of the shared terminal view (moved to @oh-dsh/shared so the
 * right-rail terminal tab and the center-surface terminal reuse the same
 * wired xterm component). Kept as a thin alias so the historically
 * panel-controls-owned terminal code keeps importing from here.
 */
export {
  TerminalView,
  type TerminalViewProps,
  type TerminalViewStatus,
} from '@oh-dsh/shared/terminal-view'