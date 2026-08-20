/**
 * Built-in file viewers of the desktop sidebar (binary / sandboxed HTML).
 * Text and markdown render through the unified ContentViewer (Pierre
 * family) — no separate plain-text renderer. Extracted from plugin.tsx.
 */
import { useState, useSyncExternalStore } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@dsh-studio/shared/i18n'
import type { WorkspaceMessage } from '../i18n.ts'
import { Alert, AlertDescription, EmptyState, Scrollable } from '@dsh-studio/shared/ui'
import type { SidebarRuntimeSettingsService } from '../runtime-settings.ts'
import {
  htmlIframeSandboxAttribute,
  resolveHtmlSurfaceUnsafe,
  type HtmlSurfaceUnsafeOverride,
} from './html-sandbox.ts'

export function BinaryFileViewer({
  onOpen,
  path,
  title,
  t,
}: {
  onOpen(): Promise<void>
  path: string
  title: string
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  return (
    <Scrollable className="dsh-studio-file-preview">
      <div>
        <strong title={path}>{title}</strong>
        <Button variant="outline" size="sm" onClick={() => { void onOpen() }}>
          {t('files.open')}
        </Button>
      </div>
      <EmptyState title={t('files.viewer.binary')} />
    </Scrollable>
  )
}

/**
 * Sandboxed HTML preview with a per-surface escape hatch. The iframe is
 * opaque-origin sandboxed by default; the status row offers a one-tap
 * "解锁/恢复" for THIS file, gated on the runtime preferences — the global
 * `htmlViewerNoSandbox` switch wins unconditionally, otherwise the surface
 * starts from `htmlViewerDefaultUnsafe` and the user's explicit toggle
 * overrides it. The unsandboxed state shows a red warning: the previewed
 * page then runs with the GUI's own origin.
 */
export function HtmlFileViewer({
  content,
  path,
  title,
  runtime,
  t,
}: {
  content: string
  path: string
  title: string
  runtime: SidebarRuntimeSettingsService
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const prefs = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot).preferences
  const [override, setOverride] = useState<HtmlSurfaceUnsafeOverride>(null)
  const unsandboxed = resolveHtmlSurfaceUnsafe(
    prefs.htmlViewerNoSandbox,
    prefs.htmlViewerDefaultUnsafe,
    override,
  )
  return (
    <Scrollable className="dsh-studio-file-preview dsh-studio-html-preview">
      <div className="dsh-studio-html-toolbar">
        <strong title={path}>{title}</strong>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setOverride(!unsandboxed) }}
          title={unsandboxed ? t('files.viewer.html-restore') : t('files.viewer.html-unlock')}
        >
          {unsandboxed ? t('files.viewer.html-restore') : t('files.viewer.html-unlock')}
        </Button>
      </div>
      {unsandboxed && (
        <Alert variant="destructive" className="dsh-studio-html-warning">
          <AlertDescription>{t('files.viewer.html-unsandboxed-warning')}</AlertDescription>
        </Alert>
      )}
      <iframe
        title={title}
        sandbox={htmlIframeSandboxAttribute(unsandboxed)}
        srcDoc={content}
      />
    </Scrollable>
  )
}