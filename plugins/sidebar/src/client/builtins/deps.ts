/**
 * The dependency bundle the built-in registrations are assembled with.
 * Every built-in descriptor is a pure function of these services, so the
 * registrations stay declarative and the assembly (plugin.tsx) only wires
 * the real services in.
 */
import type { DesktopPanels } from '../../../../panel-controls/src/client.ts'
import type { Translate } from '../../../../shared/i18n.ts'
import type { WorkspaceMessage } from '../i18n.ts'
import type { SidebarRuntimeSettingsService } from '../runtime-settings.ts'
import type { ReviewCommentsService } from '../review/review-comments.ts'
import type { WorkspaceToolsService } from '../workspace-tools.ts'
import type {
  SessionsService,
  WorkspacesService,
} from '../client-types.ts'
import type { DesktopSidebarService } from '../contract.ts'

export interface SidebarBuiltinDeps {
  openExternalPath(path: string): Promise<void>
  panels: DesktopPanels
  reviewComments: ReviewCommentsService
  /** Live user preferences (the runtime settings service). */
  runtimeSettings: SidebarRuntimeSettingsService
  service: WorkspaceToolsService
  sessions: SessionsService
  sidebar: DesktopSidebarService
  t: Translate<WorkspaceMessage>
  workspaces: WorkspacesService
}
