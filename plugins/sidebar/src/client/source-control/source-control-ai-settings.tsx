import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Menu,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { IconChevronDown, IconRefresh } from '@dsh-studio/shared/tabler-icons'
import type { Translate } from '@dsh-studio/shared/i18n'
import type { WorkspaceMessage } from '../i18n.ts'
import { sidebarApi } from '../sidebar-api.ts'
import type { CapabilitiesSourceControlAiModel } from '@dsh-studio/shared/capabilities-api'
import {
  Field,
  FieldDescription,
  FieldLabel,
  LoadingState,
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

type OpenMenu = 'model' | 'reasoning' | null

/** Source Control AI form rendered inside the sidebar Settings modal. */
export function SourceControlAiSettingsPanel(props: Props): JSX.Element {
  const [settings, setSettings] = useState<SourceControlAiSettingsValue>({ enabled: true, promptTemplate: DEFAULT_TEMPLATE })
  const [models, setModels] = useState<CapabilitiesSourceControlAiModel[]>([])
  const [fallback, setFallback] = useState<{ provider?: string; model?: string; reasoningEffort?: string }>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  const modelAnchorRef = useRef<HTMLSpanElement | null>(null)
  const reasoningAnchorRef = useRef<HTMLSpanElement | null>(null)

  const load = async (): Promise<void> => {
    setOpenMenu(null)
    setLoading(true)
    setStatus(null)
    try {
      const [saved, catalog] = await Promise.all([
        sidebarApi.sourceControlAiSettings(),
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
      setStatus({ tone: 'error', message: cause instanceof Error ? cause.message : String(cause) })
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
  const modelItems: MenuEntry[] = [
    {
      id: 'inherit',
      label: props.t('source-control-ai.default-model', {
        provider: fallback.provider ?? 'automatic',
        model: fallback.model ?? 'automatic',
      }),
    },
    ...models.map(model => ({
      id: `${model.provider}:${model.id}`,
      label: `${model.name} (${model.provider})`,
    })),
  ]
  const reasoningItems: MenuEntry[] = [
    { id: 'default', label: props.t('source-control-ai.provider-default') },
    ...(selectedModel?.reasoningEfforts ?? []).map(effort => ({ id: effort.id, label: effort.name })),
  ]
  const modelSelectionId = settings.defaultModel === undefined
    ? 'inherit'
    : `${settings.defaultModel.provider}:${settings.defaultModel.model}`
  const modelLabel = settings.defaultModel === undefined
    ? props.t('source-control-ai.default-model', {
      provider: fallback.provider ?? 'automatic',
      model: fallback.model ?? 'automatic',
    })
    : selectedModel?.name ?? `${settings.defaultModel.provider}:${settings.defaultModel.model}`
  const reasoningLabel = settings.defaultModel?.reasoningEffort === undefined
    ? props.t('source-control-ai.provider-default')
    : selectedModel?.reasoningEfforts.find(effort => effort.id === settings.defaultModel?.reasoningEffort)?.name
      ?? settings.defaultModel.reasoningEffort

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
    setOpenMenu(null)
    setSaving(true)
    setStatus(null)
    try {
      const result = await sidebarApi.updateSourceControlAiSettings({
        enabled: settings.enabled,
        promptTemplate: settings.promptTemplate,
        defaultModel: settings.defaultModel ?? null,
      })
      const value = result.value as SourceControlAiSettingsValue | undefined
      if (value !== undefined) setSettings(value)
      setStatus({ tone: 'success', message: props.t('source-control-ai.saved') })
    } catch (cause) {
      setStatus({ tone: 'error', message: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingState label={props.t('source-control-ai.loading')} />
  return (
    <div className="dsh-studio-sidebar-settings-ai">
      <div className="dsh-studio-sidebar-settings-ai-toolbar">
        <ToolbarAction
          icon={<IconRefresh size={15} />}
          label={props.t('source-control-ai.refresh')}
          disabled={loading || saving}
          onClick={() => { void load() }}
        />
      </div>
      <div className="dsh-studio-sidebar-settings-rows">
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
            <span ref={modelAnchorRef} className="dsh-studio-sidebar-settings-menu-anchor">
              <Button
                variant="outline"
                size="sm"
                aria-label={props.t('source-control-ai.model')}
                disabled={saving}
                aria-expanded={openMenu === 'model'}
                onClick={() => { setOpenMenu(current => current === 'model' ? null : 'model') }}
              >
                <span className="dsh-studio-sidebar-settings-menu-label">{modelLabel}</span>
                <IconChevronDown size={14} />
              </Button>
              <Menu
                open={openMenu === 'model' && !saving}
                anchor={null}
                portal
                getAnchorRect={() => modelAnchorRef.current?.getBoundingClientRect() ?? null}
                items={modelItems}
                selectedId={modelSelectionId}
                onSelect={id => {
                  setOpenMenu(null)
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
                onClose={() => { setOpenMenu(null) }}
              />
            </span>
          )}
        />
        <SettingsRow
          title={props.t('source-control-ai.reasoning')}
          control={(
            <span ref={reasoningAnchorRef} className="dsh-studio-sidebar-settings-menu-anchor">
              <Button
                variant="outline"
                size="sm"
                disabled={saving || selectedModel === undefined || settings.defaultModel === undefined}
                aria-label={props.t('source-control-ai.reasoning')}
                aria-expanded={openMenu === 'reasoning'}
                onClick={() => { setOpenMenu(current => current === 'reasoning' ? null : 'reasoning') }}
              >
                <span className="dsh-studio-sidebar-settings-menu-label">{reasoningLabel}</span>
                <IconChevronDown size={14} />
              </Button>
              <Menu
                open={openMenu === 'reasoning' && !saving}
                anchor={null}
                portal
                getAnchorRect={() => reasoningAnchorRef.current?.getBoundingClientRect() ?? null}
                items={reasoningItems}
                selectedId={settings.defaultModel?.reasoningEffort ?? 'default'}
                onSelect={id => {
                  setOpenMenu(null)
                  if (settings.defaultModel !== undefined) {
                    updateSelection(
                      settings.defaultModel.provider,
                      settings.defaultModel.model,
                      id === 'default' ? undefined : id,
                    )
                  }
                }}
                onClose={() => { setOpenMenu(null) }}
              />
            </span>
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
      <div className="dsh-studio-sidebar-settings-ai-actions">
        <Button variant="primary" size="sm" disabled={saving} onClick={() => { void save() }}>
          {props.t('source-control-ai.save')}
        </Button>
        {status !== null && <StatusLine tone={status.tone}>{status.message}</StatusLine>}
      </div>
    </div>
  )
}
