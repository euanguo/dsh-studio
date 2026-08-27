import { useEffect, useMemo, useState } from 'react'
import { Button, Input, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LocaleService, Translate } from '@dsh-studio/shared/i18n'
import { localeTag } from '@dsh-studio/shared/i18n'
import type { DesktopBridge } from '@dsh-studio/shared/desktop-contracts'
import type {
  MarketplaceAction,
  MarketplaceCommand,
  MarketplaceConfirmation,
  MarketplacePlugin,
  MarketplaceSnapshot,
} from '../protocol.ts'
import type { MarketplaceMessage } from './i18n.ts'
import {
  compatibilityLabel,
  compatibilityTone,
  confirmationLabel,
  formatMarketplaceCount,
  localizedDescription,
  pluginMeta,
  riskReasonLabel,
  runtimeRiskLabel,
  shortCommit,
} from './marketplace-meta.ts'
import { isMarketplaceImageUrl } from '../catalog.ts'

function primaryAction(plugin: MarketplacePlugin): MarketplaceAction | null {
  if (!plugin.installed) return 'install'
  if (plugin.updateAvailable) return 'update'
  return null
}

export function PluginDetail({
  bridge,
  pending,
  plugin,
  snapshot,
  locale,
  t,
  close,
  run,
}: {
  bridge: DesktopBridge
  pending: boolean
  plugin: MarketplacePlugin
  snapshot: MarketplaceSnapshot
  locale: LocaleService
  t: Translate<MarketplaceMessage>
  close(): void
  run(command: MarketplaceCommand): Promise<void>
}): JSX.Element {
  const [confirmations, setConfirmations] = useState<MarketplaceConfirmation[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const plan = snapshot.plan?.pluginId === plugin.id ? snapshot.plan : null
  const approval = snapshot.approval
  const request = snapshot.inputRequest?.pluginId === plugin.id ? snapshot.inputRequest : null
  const requiredConfirmations = plan?.requirements ?? approval?.requiredConfirmations ?? []
  const hasScripts = plan !== null && Object.keys(plan.buildScripts).length > 0
  const ready = requiredConfirmations.every(requirement => confirmations.includes(requirement))
  const images = useMemo(
    () => plugin.screenshots.filter(isMarketplaceImageUrl),
    [plugin.screenshots],
  )

  useEffect(() => {
    setConfirmations([])
    setAnswers({})
  }, [plugin.id, plan?.resolvedCommit])

  const selectConfirmation = (confirmation: MarketplaceConfirmation, checked: boolean): void => {
    setConfirmations(current => checked
      ? [...new Set([...current, confirmation])]
      : current.filter(entry => entry !== confirmation))
  }
  const runPlan = (action: MarketplaceAction): void => {
    void run({ type: 'plan', action, pluginId: plugin.id })
  }
  const runExecute = (mode: 'direct' | 'preview'): void => {
    if (plan === null) return
    void run({ type: 'execute', action: plan.action, mode, confirmations, pluginId: plugin.id })
  }
  const action = primaryAction(plugin)

  return (
    <section className="oh-marketplace-detail-pane" aria-label={t('details', { plugin: plugin.title })}>
      <header className="oh-marketplace-detail-header">
        <div className="oh-marketplace-detail-title">
          <h2>{plugin.title}</h2>
          <p>{pluginMeta(plugin, t)}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={close}>{t('close')}</Button>
      </header>
      <div className="oh-marketplace-detail-actions">
        {action !== null && plan === null && (
          <Button variant="primary" size="sm" disabled={pending} onClick={() => { runPlan(action) }}>
            {t(`action.${action}`)}
          </Button>
        )}
        {plan !== null && plan.execution === 'installable' && (
          <>
            <Button
              variant="primary"
              size="sm"
              disabled={pending || !ready || request !== null}
              onClick={() => { runExecute('direct') }}
            >
              {t('install-direct')}
            </Button>
            {plan.previewAvailable && (
              <Button variant="outline" size="sm" disabled={pending || !ready} onClick={() => { runExecute('preview') }}>
                {t('try-preview')}
              </Button>
            )}
          </>
        )}
        {plugin.installed && plan === null && (
          <>
            <Button variant="outline" size="sm" disabled={pending} onClick={() => { runPlan(plugin.enabled ? 'disable' : 'enable') }}>
              {plugin.enabled ? t('disable') : t('enable')}
            </Button>
            <Button variant="outline" size="sm" disabled={pending} onClick={() => { runPlan('uninstall') }}>
              {t('uninstall')}
            </Button>
          </>
        )}
        <Button variant="outline" size="sm" onClick={() => { void bridge.openExternal(plugin.url) }}>
          {t('open-repository')}
        </Button>
      </div>
      <div className="oh-marketplace-detail-scroll">
        {images.length > 0 && (
          <section className="oh-marketplace-screenshot-strip" aria-label={t('screenshots')}>
            {images.map(image => <img key={image} src={image} alt="" loading="lazy" />)}
          </section>
        )}
        <p className="oh-marketplace-detail-copy">{localizedDescription(plugin, localeTag(locale))}</p>
        {plugin.readmeSummary !== null && (
          <section className="oh-marketplace-readme-summary">
            <h3>{t('readme-summary')}</h3>
            <p>{plugin.readmeSummary}</p>
          </section>
        )}
        <div className="oh-marketplace-detail-badges">
          <Pill active={compatibilityTone(plugin.compatibility.status) === 'positive'}>
            {compatibilityLabel(plugin.compatibility.status, t)}
          </Pill>
          <Pill>{t(`trust.${plugin.trust}`)}</Pill>
          <Pill>{plugin.preferredChannel ?? 'github'}</Pill>
        </div>
        <dl className="oh-marketplace-facts">
          <dt>{t('stars')}</dt><dd>★ {formatMarketplaceCount(plugin.stars)}</dd>
          <dt>{t('downloads')}</dt><dd>↓ {formatMarketplaceCount(plugin.downloads)}</dd>
          <dt>{t('compatibility')}</dt><dd>{compatibilityLabel(plugin.compatibility.status, t)}{plugin.compatibility.lastVerified === null ? '' : ` · ${plugin.compatibility.lastVerified}`}</dd>
          <dt>{t('repository')}</dt><dd>{plugin.repository}</dd>
          <dt>{t('trust')}</dt><dd>{t(`trust.${plugin.trust}`)}</dd>
          <dt>{t('runtime-boundary')}</dt><dd>{runtimeRiskLabel(plugin, t)}</dd>
          <dt>{t('channel')}</dt><dd>{plugin.preferredChannel ?? 'github'}</dd>
          {plugin.npm !== null && <><dt>{t('package')}</dt><dd>{plugin.npm}</dd></>}
          {plugin.version !== null && <><dt>{t('version')}</dt><dd>{plugin.version}</dd></>}
          {plugin.pushedAt !== null && <><dt>{t('updated')}</dt><dd>{new Date(plugin.pushedAt).toLocaleString(localeTag(locale))}</dd></>}
          {plugin.currentCommit !== null && <><dt>{t('current-commit')}</dt><dd>{shortCommit(plugin.currentCommit)}</dd></>}
          {plugin.latestCommit !== null && <><dt>{t('latest-commit')}</dt><dd>{shortCommit(plugin.latestCommit)}</dd></>}
        </dl>
        {plan !== null && (
          <section className="oh-marketplace-plan">
            <h3>{t('plan-title', { action: t(`action.${plan.action}`) })}</h3>
            <div className="oh-marketplace-plan-summary">
              <span data-risk={plan.riskLevel}>{t(`risk-level.${plan.riskLevel}`)}</span>
              <span>{plan.channel}</span>
              {plan.fastPathEligible && <span>{t('fast-path-ready')}</span>}
            </div>
            {plan.riskReasons.length > 0 && (
              <ul className="oh-marketplace-risk-reasons">
                {plan.riskReasons.map(reason => <li key={reason}>{riskReasonLabel(reason, t)}</li>)}
              </ul>
            )}
            {hasScripts && <pre className="oh-marketplace-scripts">{Object.entries(plan.buildScripts).map(([name, script]) => `${name}: ${script}`).join('\n')}</pre>}
            {requiredConfirmations.map(requirement => (
              <label className="oh-marketplace-confirm" key={requirement}>
                <input checked={confirmations.includes(requirement)} onChange={event => { selectConfirmation(requirement, event.target.checked) }} type="checkbox" />
                <span>{confirmationLabel(requirement, t)}</span>
              </label>
            ))}
          </section>
        )}
        {request !== null && (
          <section className="oh-marketplace-input-request">
            <h3>{t('configuration-required')}</h3>
            {request.requirements.map(requirement => (
              <label key={requirement.name} htmlFor={`marketplace-material-${requirement.name}`}>
                <span>{requirement.name}</span>
                <Input
                  id={`marketplace-material-${requirement.name}`}
                  type={requirement.secret ? 'password' : 'text'}
                  value={answers[requirement.name] ?? ''}
                  placeholder={requirement.description}
                  onChange={event => { setAnswers(current => ({ ...current, [requirement.name]: event.target.value })) }}
                />
              </label>
            ))}
            <Button
              variant="primary"
              size="sm"
              disabled={pending || request.requirements.some(requirement => (answers[requirement.name] ?? '').trim() === '')}
              onClick={() => { void run({ type: 'provide', transactionId: request.transactionId, answers }) }}
            >
              {t('continue-install')}
            </Button>
          </section>
        )}
      </div>
    </section>
  )
}
