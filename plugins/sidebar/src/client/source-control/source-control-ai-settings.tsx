import { SidebarSurfaceCss as surfaceCss } from '../styles.js'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconRefresh } from '@dsh-studio/shared/tabler-icons'
import type { Translate } from '@dsh-studio/shared/i18n'
import type { WorkspaceMessage } from '../i18n.ts'
import { sidebarApi } from '../sidebar-api.ts'
import {
  callCapabilitiesGlobalApi,
  SOURCE_CONTROL_AI_SETTINGS_NS,
} from '@dsh-studio/shared/capabilities-api'
import type { CapabilitiesSourceControlAiModel } from '@dsh-studio/shared/capabilities-api'
import { errorMessage } from '@dsh-studio/shared/errors'
import {
  Field,
  FieldDescription,
  FieldLabel,
  LoadingState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsRow,
  StatusLine,
  Switch,
  Textarea,
  ToolbarAction,
} from '@dsh-studio/shared/ui'

interface SourceControlAiSettingsValue {
  enabled: boolean
  defaultModel?: { provider: string; model: string; reasoningEffort?: string }
  promptTemplate: string
}

interface Props {
  t: Translate<WorkspaceMessage>
}

const DEFAULT_TEMPLATE = [
  'Write one concise Git commit message for the staged changes.',
  'Use imperative mood. Return only the message, without quotes, markdown, or explanation.',
  '',
  'Repository: {repository}',
  'Branch: {branch}',
  '',
  'Staged patch:',
  '{stagedPatch}',
].join('\n')

/** Source Control AI form rendered inside the sidebar Settings modal. */
export function SourceControlAiSettingsPanel(props: Props): JSX.Element {
  const [settings, setSettings] = useState<SourceControlAiSettingsValue>({ enabled: true, promptTemplate: DEFAULT_TEMPLATE })
  const [models, setModels] = useState<CapabilitiesSourceControlAiModel[]>([])
  const [fallback, setFallback] = useState<{ provider?: string; model?: string; reasoningEffort?: string }>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)

  const load = async (): Promise<void> => {
    setLoading(true)
    setStatus(null)
    try {
      const [saved, catalog] = await Promise.all([
        // The prefs ride the same generic settings.* seam as the sidebar
        // prefs; only the read-only model catalog keeps its dedicated RPC.
        callCapabilitiesGlobalApi<{ value?: unknown; revision?: number }>(
          'settings.get',
          { ns: SOURCE_CONTROL_AI_SETTINGS_NS },
        ),
        sidebarApi.sourceControlAiModels(),
      ])
      const value = saved.value as Partial<SourceControlAiSettingsValue> | undefined
      setSettings({
        enabled: value?.enabled !== false,
        ...(value?.defaultModel === undefined ? {} : { defaultModel: value.defaultModel }),
        promptTemplate: value?.promptTemplate?.trim() === '' || value?.promptTemplate === undefined
          ? DEFAULT_TEMPLATE
          : value.promptTemplate,
      })
      setModels(catalog.models)
      setFallback(catalog.defaultModel)
    } catch (cause) {
      setStatus({ tone: 'error', message: errorMessage(cause) })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const selected = settings.defaultModel ?? fallback
  const selectedModel = useMemo(
    () => models.find(model => model.provider === selected.provider && model.id === selected.model),
    [models, selected.model, selected.provider],
  )
  const modelItems: { value: string; label: string }[] = [
    {
      value: 'inherit',
      label: props.t('source-control-ai.default-model', {
        provider: fallback.provider ?? 'automatic',
        model: fallback.model ?? 'automatic',
      }),
    },
    ...models.map(model => ({
      value: `${model.provider}:${model.id}`,
      label: `${model.name} (${model.provider})`,
    })),
  ]
  const reasoningItems: { value: string; label: string }[] = [
    { value: 'default', label: props.t('source-control-ai.provider-default') },
    ...(selectedModel?.reasoningEfforts ?? []).map(effort => ({ value: effort.id, label: effort.name })),
  ]
  const modelSelectionId = settings.defaultModel === undefined
    ? 'inherit'
    : `${settings.defaultModel.provider}:${settings.defaultModel.model}`

  const updateSelection = (provider: string, model: string, reasoningEffort?: string): void => {
    setSettings(current => ({
      ...current,
      defaultModel: {
        provider,
        model,
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      },
    }))
  }
  const save = async (): Promise<void> => {
    setSaving(true)
    setStatus(null)
    try {
      // Write through the generic settings.seam: a merge patch for the
      // scalar fields plus the model override, then a path unset when the
      // override was cleared (merge cannot delete a key).
      const patch: Record<string, unknown> = {
        enabled: settings.enabled,
        promptTemplate: settings.promptTemplate,
        ...(settings.defaultModel === undefined ? {} : { defaultModel: settings.defaultModel }),
      }
      let result = await callCapabilitiesGlobalApi<{ value?: unknown; revision?: number }>(
        'settings.update',
        { ns: SOURCE_CONTROL_AI_SETTINGS_NS, patch },
      )
      if (settings.defaultModel === undefined) {
        result = await callCapabilitiesGlobalApi<{ value?: unknown; revision?: number }>(
          'settings.mutate',
          { ns: SOURCE_CONTROL_AI_SETTINGS_NS, ops: [{ op: 'unset', path: ['defaultModel'] }] },
        )
      }
      const value = result.value as SourceControlAiSettingsValue | undefined
      if (value !== undefined) setSettings(value)
      setStatus({ tone: 'success', message: props.t('source-control-ai.saved') })
    } catch (cause) {
      setStatus({ tone: 'error', message: errorMessage(cause) })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingState label={props.t('source-control-ai.loading')} />
  return (
    <div className={surfaceCss["dsh-studio-sidebar-settings-ai"]}>
      <div className={surfaceCss["dsh-studio-sidebar-settings-ai-toolbar"]}>
        <ToolbarAction
          icon={<IconRefresh size={15} />}
          label={props.t('source-control-ai.refresh')}
          disabled={loading || saving}
          onClick={() => { void load() }}
        />
      </div>
      <div className={surfaceCss["dsh-studio-sidebar-settings-rows"]}>
        <SettingsRow
          title={props.t('source-control-ai.enabled')}
          control={(
            <Switch
              checked={settings.enabled}
              disabled={saving}
              aria-label={props.t('source-control-ai.enabled')}
              onCheckedChange={enabled => {
                setSettings(current => ({ ...current, enabled }))
              }}
            />
          )}
        />
        <SettingsRow
          title={props.t('source-control-ai.model')}
          control={(
            <Select
              disabled={saving}
              items={modelItems}
              value={modelSelectionId}
              onValueChange={id => {
                if (id === null) return
                if (id === 'inherit') {
                  setSettings(current => {
                    const { defaultModel: _defaultModel, ...rest } = current
                    return rest
                  })
                  return
                }
                const [provider, model] = id.split(':')
                if (provider !== undefined && model !== undefined) updateSelection(provider, model)
              }}
            >
              <SelectTrigger size="sm" aria-label={props.t('source-control-ai.model')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end" alignItemWithTrigger={false}>
                {modelItems.map(item => (
                  <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        <SettingsRow
          title={props.t('source-control-ai.reasoning')}
          control={(
            <Select
              disabled={saving || selectedModel === undefined || settings.defaultModel === undefined}
              items={reasoningItems}
              value={settings.defaultModel?.reasoningEffort ?? 'default'}
              onValueChange={id => {
                if (id === null) return
                if (settings.defaultModel !== undefined) {
                  updateSelection(
                    settings.defaultModel.provider,
                    settings.defaultModel.model,
                    id === 'default' ? undefined : id,
                  )
                }
              }}
            >
              <SelectTrigger size="sm" aria-label={props.t('source-control-ai.reasoning')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end" alignItemWithTrigger={false}>
                {reasoningItems.map(item => (
                  <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        <Field>
          <FieldLabel htmlFor="dsh-studio-source-control-ai-prompt">
            {props.t('source-control-ai.prompt-template')}
          </FieldLabel>
          <Textarea
            id="dsh-studio-source-control-ai-prompt"
            value={settings.promptTemplate}
            disabled={saving}
            aria-label={props.t('source-control-ai.prompt-template')}
            onChange={event => {
              const promptTemplate = event.currentTarget.value
              setSettings(current => ({ ...current, promptTemplate }))
            }}
          />
          <FieldDescription>{props.t('source-control-ai.variables')}</FieldDescription>
        </Field>
      </div>
      <div className={surfaceCss["dsh-studio-sidebar-settings-ai-actions"]}>
        <Button variant="primary" size="sm" disabled={saving} onClick={() => { void save() }}>
          {props.t('source-control-ai.save')}
        </Button>
        {status !== null && <StatusLine tone={status.tone}>{status.message}</StatusLine>}
      </div>
    </div>
  )
}
