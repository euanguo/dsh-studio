/** /capabilities settings.* handlers: revision-guarded reads and writes on
 *  the plugin-owned namespaces through the mounted settings seam. Split from
 *  routes.ts. */
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import {
  CapabilityError,
  requireString,
} from '@dsh-studio/shared/wire'
import {
  isSettingsPathOp,
  settingsNamespaceOf,
  type CapabilitiesSettingsFace,
  type SettingsPathEdit,
} from './shared.ts'
import type { ApiMethod } from './types.ts'

/** Dependency face for the settings route group. */
export interface SettingsHandlerDeps {
  getSettings(): CapabilitiesSettingsFace | undefined
}

/** Build the settings.* route group. */
export function buildSettingsHandlers(deps: SettingsHandlerDeps): Record<string, ApiMethod> {
  const { getSettings } = deps
  return {
    // The side card preferences. The settings service is optional in the
    // composition; while absent the routes report undefined and the client
    // keeps the schema defaults. Writes are revision-guarded: a stale editor
    // is refused with settings-conflict so a concurrent change is never
    // silently overwritten (mirror of the settings seam's own guard).
    'settings.get': (payload) => {
      const settings = getSettings()
      const ns = settingsNamespaceOf(payload)
      return settings?.get(ns) ?? { value: undefined, revision: undefined }
    },
    'settings.update': async (payload) => {
      const settings = getSettings()
      if (settings === undefined) {
        throw new CapabilityError('settings-rejected', 'the settings service is not mounted in this deployment', 503)
      }
      const record = payload as { ns?: unknown; patch?: unknown; expectedRevision?: unknown } | null
      const patch = record?.patch
      if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new CapabilityError('bad-request', 'patch must be a plain object')
      }
      const ns = settingsNamespaceOf(payload)
      const expectedRevision = typeof record?.expectedRevision === 'number' ? record.expectedRevision : undefined
      try {
        return await settings.update(ns, patch as Record<string, unknown>, expectedRevision)
      } catch (error) {
        if (error instanceof SettingsConflictError) {
          throw new CapabilityError('settings-conflict', error.message, 409)
        }
        throw new CapabilityError('settings-rejected', error instanceof Error ? error.message : String(error), 400)
      }
    },
    // Wholesale replace of one namespace's user section. Unlike a merge patch,
    // replace expresses deletion — keys absent from the section are removed —
    // so this is the reset-to-auto / clear-alias / remove-group path.
    'settings.replace': async (payload) => {
      const settings = getSettings()
      if (settings === undefined) {
        throw new CapabilityError('settings-rejected', 'the settings service is not mounted in this deployment', 503)
      }
      const record = payload as { ns?: unknown; section?: unknown; expectedRevision?: unknown } | null
      const section = record?.section
      if (section === null || typeof section !== 'object' || Array.isArray(section)) {
        throw new CapabilityError('bad-request', 'section must be a plain object')
      }
      const ns = settingsNamespaceOf(payload)
      const expectedRevision = typeof record?.expectedRevision === 'number' ? record.expectedRevision : undefined
      try {
        return await settings.replace(ns, section as Record<string, unknown>, expectedRevision)
      } catch (error) {
        if (error instanceof SettingsConflictError) {
          throw new CapabilityError('settings-conflict', error.message, 409)
        }
        throw new CapabilityError('settings-rejected', error instanceof Error ? error.message : String(error), 400)
      }
    },
    // Path-addressed set/unset edits on one namespace (the native delete op).
    'settings.mutate': async (payload) => {
      const settings = getSettings()
      if (settings === undefined) {
        throw new CapabilityError('settings-rejected', 'the settings service is not mounted in this deployment', 503)
      }
      const record = payload as { ns?: unknown; ops?: unknown; expectedRevision?: unknown } | null
      const rawOps = record?.ops
      if (!Array.isArray(rawOps) || rawOps.length === 0 || !rawOps.every(isSettingsPathOp)) {
        throw new CapabilityError('bad-request', 'ops must be a non-empty array of {op,path} edits')
      }
      const ns = settingsNamespaceOf(payload)
      const expectedRevision = typeof record?.expectedRevision === 'number' ? record.expectedRevision : undefined
      try {
        return await settings.mutate(ns, rawOps as SettingsPathEdit[], expectedRevision)
      } catch (error) {
        if (error instanceof SettingsConflictError) {
          throw new CapabilityError('settings-conflict', error.message, 409)
        }
        throw new CapabilityError('settings-rejected', error instanceof Error ? error.message : String(error), 400)
      }
    },
  }
}

export { requireString }