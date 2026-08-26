/**
 * Settings domain for the capability gateway: namespace registration
 * (sidebar prefs / left-rail view slice / source-control AI), the legacy
 * left-rail slice migration and its gate, best-effort legacy pref cleanup,
 * and the structural settings face served through the fenced routes.
 *
 * Ownership split: this factory owns registration/migration/face construction;
 * the caller owns the live prefs snapshot, shell follow-up, and tool-gate
 * syncing via {@link SettingsDomainHooks} — invoked once after registration
 * (initial commit) and on every subsequent watch tick, in that order, exactly
 * like the inline original.
 */
import {
  LeftRailSettingsSchema,
  PrefsSchema,
} from '../config.ts'
import {
  SIDEBAR_PREFS_NS,
  type SidebarPrefs,
} from '@dsh-studio/shared/prefs-shared'
import { migrateLegacyLeftRailSlice } from '../left-rail-settings-migration.ts'
import { cleanupLegacySidebarPrefs } from '../sidebar-prefs-cleanup.ts'
import { LEFT_RAIL_SETTINGS_NS } from '@dsh-studio/shared/left-rail-preferences'
import {
  SourceControlAiGenerator,
  SourceControlAiSettingsSchema,
} from '../source-control-ai.ts'
import { SOURCE_CONTROL_AI_SETTINGS_NS } from '@dsh-studio/shared/capabilities-api'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { errorMessage } from '@dsh-studio/shared/errors'
import type { CapabilitiesSettingsFace } from '../routes.ts'
import type { Context } from '../context-types.ts'

/** The slice of the cordis settings scope the tool-gate sync consumes. */
export interface SettingsScopeLike {
  get(): SidebarPrefs
}

export interface SettingsDomainHooks {
  /** Called once right after registration with the live scope. */
  onInitial(scope: SettingsScopeLike): void
  /** Called on every committed change with the new prefs snapshot. */
  onChange(next: SidebarPrefs, scope: SettingsScopeLike): void
}

export interface SettingsDomain {
  settingsFace: CapabilitiesSettingsFace | undefined
  sourceControlAiGenerator: SourceControlAiGenerator | undefined
  leftRailGate: Promise<void> | undefined
}

export function createSettingsDomain(ctx: Context, hooks: SettingsDomainHooks): SettingsDomain {
  let settingsFace: CapabilitiesSettingsFace | undefined
  let sourceControlAiGenerator: SourceControlAiGenerator | undefined
  // Migration of any legacy left-rail slice out of the sidebar namespace into
  // dsh-studio-left-rail. The routes gate the left-rail namespace on this promise
  // so a cold-start first read never observes the empty pre-migration window.
  let leftRailMigrationGate: Promise<void> | undefined

  // Await the left-rail migration gate for the left-rail namespace only; the
  // sidebar prefs namespace never waits (it is the migration's source, and
  // reads there must work before the move settles).
  const settingsNamespaceGate = async (rawNs: string, gate: () => Promise<void> | undefined): Promise<void> => {
    if (rawNs === LEFT_RAIL_SETTINGS_NS) await gate()
  }

  // `settings` is a top-level injected dependency. Do not create a nested
  // `ctx.inject()` and retain that child context in HTTP routes: its scoped
  // accessor becomes inactive after the callback settles. The face below must
  // close over the plugin's lifetime-stable `ctx` instead.
  /** Brand-check a raw namespace once, then unwrap it to the plain string the
   *  structural settings face consumes (this bundle stays dsh-settings-free). */
  const namespaceKeyOf = (raw: string): string => settingsNamespace(raw) as unknown as string
  {
    // The left-rail view slice gets its OWN namespace + schema (see
    // docs/persistence-architecture.md, decision B). Registering it here
    // gives the slice defaults/validation and a dedicated section in the
    // settings document; the client writes it through replace/mutate so
    // deletions (icon reset, alias clear, group unassign) actually persist.
    // The structural settings mirror types `schema` as unknown, so the
    // generic is not inferred here; the real service resolves it from the
    // schemastery schema (PrefsSchema / LeftRailSettingsSchema) — narrow the
    // owner scope explicitly.
    const scope = ctx.settings.register(namespaceKeyOf(SIDEBAR_PREFS_NS), PrefsSchema) as {
      get(): SidebarPrefs
      watch(callback: (next: SidebarPrefs, prev: SidebarPrefs) => void): () => void
    }
    ctx.settings.register(namespaceKeyOf(LEFT_RAIL_SETTINGS_NS), LeftRailSettingsSchema)
    ctx.settings.register(
      namespaceKeyOf(SOURCE_CONTROL_AI_SETTINGS_NS),
      SourceControlAiSettingsSchema,
      { applies: 'live' },
    )
    sourceControlAiGenerator = new SourceControlAiGenerator(ctx.llm)
    // Move any slice that historically rode in the sidebar namespace into the
    // dedicated namespace, once, idempotently. Failure is contained: the
    // routes still work (reads fall back to the sidebar view), a retry next
    // boot completes the move. The gate lets left-rail reads/writes await the
    // move so the first load never sees an empty target.
    leftRailMigrationGate = migrateLegacyLeftRailSlice({
      describe: (ns) => {
        const descriptor = ctx.settings.describe({ redactSecrets: true })
          .find(candidate => candidate.ns === namespaceKeyOf(ns))
        return descriptor === undefined
          ? {}
          : { user: descriptor.user, revision: descriptor.revision }
      },
      replace: (ns, section) => ctx.settings.replace(namespaceKeyOf(ns), section),
      mutate: (ns, ops) => ctx.settings.mutate(namespaceKeyOf(ns), ops),
    }).then(
      () => undefined,
      (error) => {
        ctx.logger?.warn?.(`[left-rail] settings migration failed: ${errorMessage(error)}`)
      },
    )
    // Best-effort cleanup of sidebar prefs removed from the schema
    // (openByDefault / defaultWidthPercent / bottomPanelAutoTerminal /
    // browserNoSandbox). No code reads them, so this is housekeeping only;
    // failure is contained and retried next boot.
    void cleanupLegacySidebarPrefs({
      describe: (ns) => {
        const descriptor = ctx.settings.describe({ redactSecrets: true })
          .find(candidate => candidate.ns === namespaceKeyOf(ns))
        return descriptor === undefined
          ? {}
          : { user: descriptor.user, revision: descriptor.revision }
      },
      mutate: (ns, ops) => ctx.settings.mutate(namespaceKeyOf(ns), ops),
    }).then(
      () => undefined,
      (error) => {
        ctx.logger?.warn?.(`[sidebar] legacy pref cleanup failed: ${errorMessage(error)}`)
      },
    )
    const viewOf = (target: string): { value?: unknown; revision?: number } => {
      const descriptor = ctx.settings.describe({ redactSecrets: true }).find(candidate => candidate.ns === target)
      return descriptor === undefined
        ? {}
        : { value: descriptor.value, revision: descriptor.revision }
    }
    settingsFace = {
      get: async (rawNs) => {
        await settingsNamespaceGate(rawNs, () => leftRailMigrationGate)
        return viewOf(namespaceKeyOf(rawNs))
      },
      update: async (rawNs, patch, expectedRevision) => {
        await settingsNamespaceGate(rawNs, () => leftRailMigrationGate)
        await ctx.settings.update(namespaceKeyOf(rawNs), patch, expectedRevision)
        return viewOf(namespaceKeyOf(rawNs))
      },
      replace: async (rawNs, section, expectedRevision) => {
        await settingsNamespaceGate(rawNs, () => leftRailMigrationGate)
        await ctx.settings.replace(namespaceKeyOf(rawNs), section, expectedRevision)
        return viewOf(namespaceKeyOf(rawNs))
      },
      mutate: async (rawNs, ops, expectedRevision) => {
        await settingsNamespaceGate(rawNs, () => leftRailMigrationGate)
        await ctx.settings.mutate(namespaceKeyOf(rawNs), ops, expectedRevision)
        return viewOf(namespaceKeyOf(rawNs))
      },
    }
    // Hand the freshly registered scope to the caller's initial-commit hook
    // (prefs snapshot + shell follow-up + tool-gate sync), then keep those
    // hooks fed on every committed change.
    hooks.onInitial(scope)
    scope.watch((next) => {
      hooks.onChange(next, scope)
    })
  }
  return { settingsFace, sourceControlAiGenerator, leftRailGate: leftRailMigrationGate }
}
