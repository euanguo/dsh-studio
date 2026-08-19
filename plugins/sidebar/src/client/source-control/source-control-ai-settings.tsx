import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Menu,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { IconChevronDown, IconRefresh } from '@oh-dsh/shared/tabler-icons'
import type { Translate } from '@oh-dsh/shared/i18n'
import type { WorkspaceMessage } from '../i18n.ts'
import { sidebarApi } from '../sidebar-api.ts'
import type { SidebarSourceControlAiModel } from '@oh-dsh/shared/sidebar-api'

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
  const [models, setModels] = useState<SidebarSourceControlAiModel[]>([])
  const [fallback, setFallback] = useState<{ provider?: string; model?: string; reasoningEffort?: string }>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  const modelAnchorRef = useRef<HTMLSpanElement | null>(null)
  const reasoningAnchorRef = useRef<HTMLSpanElement | null>(null)

  const load = async (): Promise<void> => {
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
      setStatus(cause instanceof Error ? cause.message : String(cause))
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
      setStatus(props.t('source-control-ai.saved'))
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="oh-dsh-sidebar-settings-ai">{props.t('source-control-ai.loading')}</div>
  return (
    <div className="oh-dsh-sidebar-settings-ai">
      <div className="oh-dsh-sidebar-settings-ai-toolbar">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { void load() }}
          title={props.t('source-control-ai.refresh')}
          aria-label={props.t('source-control-ai.refresh')}
        >
          <IconRefresh size={15} />
        </Button>
      </div>
      <div className="oh-dsh-sidebar-settings-grid">
        <label className="oh-dsh-sidebar-settings-row" title={props.t('source-control-ai.enabled')}>
          <span className="oh-dsh-sidebar-settings-copy"><strong>{props.t('source-control-ai.enabled')}</strong></span>
          <input
            type="checkbox"
            checked={settings.enabled}
            aria-label={props.t('source-control-ai.enabled')}
            onChange={event => {
              const enabled = event.currentTarget.checked
              setSettings(current => ({ ...current, enabled }))
            }}
          />
        </label>
        <div className="oh-dsh-sidebar-settings-row">
          <span className="oh-dsh-sidebar-settings-copy"><strong>{props.t('source-control-ai.model')}</strong></span>
          <span ref={modelAnchorRef} className="oh-dsh-sidebar-settings-menu-anchor">
            <Button
              variant="outline"
              size="sm"
              aria-label={props.t('source-control-ai.model')}
              aria-expanded={openMenu === 'model'}
              onClick={() => { setOpenMenu(current => current === 'model' ? null : 'model') }}
            >
              <span className="oh-dsh-sidebar-settings-menu-label">{modelLabel}</span>
              <IconChevronDown size={14} />
            </Button>
            <Menu
              open={openMenu === 'model'}
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
        </div>
        <div className="oh-dsh-sidebar-settings-row">
          <span className="oh-dsh-sidebar-settings-copy"><strong>{props.t('source-control-ai.reasoning')}</strong></span>
          <span ref={reasoningAnchorRef} className="oh-dsh-sidebar-settings-menu-anchor">
            <Button
              variant="outline"
              size="sm"
              disabled={selectedModel === undefined || settings.defaultModel === undefined}
              aria-label={props.t('source-control-ai.reasoning')}
              aria-expanded={openMenu === 'reasoning'}
              onClick={() => { setOpenMenu(current => current === 'reasoning' ? null : 'reasoning') }}
            >
              <span className="oh-dsh-sidebar-settings-menu-label">{reasoningLabel}</span>
              <IconChevronDown size={14} />
            </Button>
            <Menu
              open={openMenu === 'reasoning'}
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
        </div>
        <label className="oh-dsh-sidebar-settings-ai-prompt">
          <span className="oh-dsh-sidebar-settings-copy"><strong>{props.t('source-control-ai.prompt-template')}</strong></span>
          <textarea
            value={settings.promptTemplate}
            aria-label={props.t('source-control-ai.prompt-template')}
            onChange={event => {
              const promptTemplate = event.currentTarget.value
              setSettings(current => ({ ...current, promptTemplate }))
            }}
          />
          <small>{props.t('source-control-ai.variables')}</small>
        </label>
      </div>
      <div className="oh-dsh-sidebar-settings-ai-actions">
        <Button variant="primary" size="sm" disabled={saving} onClick={() => { void save() }}>
          {props.t('source-control-ai.save')}
        </Button>
        {status !== null && <small>{status}</small>}
      </div>
    </div>
  )
}
