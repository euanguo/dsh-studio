import { useEffect, useMemo, useState } from 'react'
import { Button, Input, Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
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
  mechanismLabel,
  riskReasonLabel,
  runtimeRiskLabel,
  shortCommit,
} from './marketplace-meta.ts'
import { isMarketplaceImageUrl } from '../catalog.ts'

function primaryAction(plugin: MarketplacePlugin): MarketplaceAction | null {
  if (!plugin.installed) return 'install'
  if (plugin.updateAvailable) return 'update'
  if (!plugin.enabled) return 'enable'
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
  const [menuOpen, setMenuOpen] = useState(false)
  const plan = snapshot.plan?.pluginId === plugin.id ? snapshot.plan : null
  const request = snapshot.inputRequest?.pluginId === plugin.id ? snapshot.inputRequest : null
  const requiredConfirmations = plan?.requirements ?? []
  const hasScripts = plan !== null && Object.keys(plan.buildScripts).length > 0
  const ready = requiredConfirmations.every(requirement => confirmations.includes(requirement))
  const hasPreview = snapshot.preview !== null
  const images = useMemo(
    () => plugin.screenshots.filter(isMarketplaceImageUrl),
    [plugin.screenshots],
  )

  useEffect(() => {
    setConfirmations([])
    setAnswers({})
    setMenuOpen(false)
  }, [plugin.id, plan?.resolvedCommit])

  const selectConfirmation = (confirmation: MarketplaceConfirmation, checked: boolean): void => {
    setConfirmations(current => checked
      ? [...new Set([...current, confirmation])]
      : current.filter(entry => entry !== confirmation))
  }
  const runPlan = (action: MarketplaceAction): void => {
    setMenuOpen(false)
    void run({ type: 'plan', action, pluginId: plugin.id })
  }
  const runExecute = (mode: 'direct' | 'preview'): void => {
    if (plan === null) return
    void run({ type: 'execute', action: plan.action, mode, confirmations, pluginId: plugin.id })
  }
  const action = primaryAction(plugin)
  const menuItems: MenuEntry[] = [
    { id: 'open-repository', label: t('open-repository') },
    ...(plugin.installed
      ? [
          { id: 'toggle', label: plugin.enabled ? t('disable') : t('enable') },
          { id: 'uninstall', label: t('uninstall'), danger: true },
        ]
      : []),
  ]

  return (
    <section className="oh-marketplace-detail-pane" aria-label={t('details', { plugin: plugin.title })}>
      <header className="oh-marketplace-detail-header">
        <Button className="oh-marketplace-detail-back" onClick={close} size="sm" variant="ghost">{t('back-to-results')}</Button>
        <div className="oh-marketplace-detail-title">
          <h2>{plugin.title}</h2>
          <p>{plugin.category} · {mechanismLabel(plugin, t)}</p>
        </div>
        <Menu
          open={menuOpen}
          onClose={() => { setMenuOpen(false) }}
          items={menuItems}
          align="end"
          portal
          dense
          onSelect={id => {
            setMenuOpen(false)
            if (id === 'open-repository') void bridge.openExternal(plugin.url)
            if (id === 'toggle') runPlan(plugin.enabled ? 'disable' : 'enable')
            if (id === 'uninstall') runPlan('uninstall')
          }}
          anchor={(
            <Button
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label={t('more-actions')}
              className="oh-marketplace-more-trigger"
              onClick={() => { setMenuOpen(current => !current) }}
              size="sm"
              variant="ghost"
            >
              {t('more-actions')}
            </Button>
          )}
        />
      </header>
      <div className="oh-marketplace-detail-actions">
        {action !== null && plan === null && !hasPreview && (
          <Button variant="primary" size="sm" disabled={pending} onClick={() => { void run({ type: 'plan', action, pluginId: plugin.id }) }}>
            {t(`action.${action}`)}
          </Button>
        )}
        {action === null && plugin.installed && plan === null && !hasPreview && (
          <Button variant="primary" size="sm" disabled>{t('installed-status')}</Button>
        )}
        {plan !== null && plan.execution === 'installable' && !hasPreview && (
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
        {hasPreview && <span className="oh-marketplace-detail-transaction-state">{t('preview-in-progress')}</span>}
      </div>
      <div className="oh-marketplace-detail-scroll">
        <p className="oh-marketplace-detail-copy">{localizedDescription(plugin, localeTag(locale))}</p>
        <div className="oh-marketplace-detail-badges">
          <span className="oh-marketplace-compatibility" data-tone={compatibilityTone(plugin.compatibility.status)}>
            <span aria-hidden="true" className="oh-marketplace-compatibility-dot" />
            {compatibilityLabel(plugin.compatibility.status, t)}
          </span>
          <span>{t(`trust.${plugin.trust}`)}</span>
          <span>{runtimeRiskLabel(plugin, t)}</span>
          {plugin.updateAvailable && <span className="oh-marketplace-detail-update">{t('update-available')}</span>}
        </div>
        {plan !== null && (
          <section className="oh-marketplace-plan" aria-labelledby="marketplace-plan-title">
            <div className="oh-marketplace-section-heading">
              <div>
                <h3 id="marketplace-plan-title">{t('plan-title', { action: t(`action.${plan.action}`) })}</h3>
                <p>{t('review-before-install')}</p>
              </div>
              <span className="oh-marketplace-risk-level" data-risk={plan.riskLevel}>{t(`risk-level.${plan.riskLevel}`)}</span>
            </div>
            <div className="oh-marketplace-plan-summary">
              <span>{plan.channel}</span>
              {plan.fastPathEligible && <span>{t('fast-path-ready')}</span>}
              {plan.requiresRestart && <span>{t('restart-required')}</span>}
            </div>
            {plan.riskReasons.length > 0 && (
              <ul className="oh-marketplace-risk-reasons">
                {plan.riskReasons.map(reason => <li key={reason}>{riskReasonLabel(reason, t)}</li>)}
              </ul>
            )}
            {plan.execution !== 'installable' && <p className="oh-marketplace-plan-line">{t('plan-not-installable')}</p>}
            {hasScripts && <pre className="oh-marketplace-scripts">{Object.entries(plan.buildScripts).map(([name, script]) => `${name}: ${script}`).join('\n')}</pre>}
            {requiredConfirmations.length > 0 && <div className="oh-marketplace-confirmations">
              <strong>{t('confirm-before-install')}</strong>
              {requiredConfirmations.map(requirement => (
                <label className="oh-marketplace-confirm" key={requirement}>
                  <input checked={confirmations.includes(requirement)} onChange={event => { selectConfirmation(requirement, event.target.checked) }} type="checkbox" />
                  <span>{confirmationLabel(requirement, t)}</span>
                </label>
              ))}
            </div>}
          </section>
        )}
        {request !== null && (
          <section className="oh-marketplace-input-request">
            <div>
              <strong>{t('configuration-required')}</strong>
              <p>{t('configuration-help')}</p>
            </div>
            <div className="oh-marketplace-input-fields">
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
            </div>
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
        <details className="oh-marketplace-detail-section" open>
          <summary>{t('overview')}</summary>
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
        </details>
        {images.length > 0 && (
          <details className="oh-marketplace-detail-section">
            <summary>{t('screenshots')}</summary>
            <div className="oh-marketplace-screenshot-strip" aria-label={t('screenshots')}>
              {images.map(image => <img key={image} src={image} alt="" loading="lazy" />)}
            </div>
          </details>
        )}
        {plugin.readmeSummary !== null && (
          <details className="oh-marketplace-detail-section">
            <summary>{t('readme-summary')}</summary>
            <p className="oh-marketplace-readme-copy">{plugin.readmeSummary}</p>
          </details>
        )}
      </div>
    </section>
  )
}
