import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { ToolbarAction } from '@dsh-studio/shared/ui'
import type { LocaleService, Translate } from '@dsh-studio/shared/i18n'
import { localeTag } from '@dsh-studio/shared/i18n'
import type { DesktopBridge } from '@dsh-studio/shared/desktop-contracts'
import { IconArrowLeft, IconDots, IconDownload, IconExternalLink, IconStar } from '@dsh-studio/shared/tabler-icons'
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
import { getCategoryIcon } from './marketplace-browse.tsx'
import { MarketplaceCss as css } from './styles.js'

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
  const moreAnchorRef = useRef<HTMLSpanElement | null>(null)
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
          { id: 'uninstall', label: t('uninstall'), danger: true },
        ]
      : []),
  ]

  return (
    <div className={css.detail} aria-label={t('details', { plugin: plugin.title })}>
      {/* Detail Header */}
      <header className={css.detailHeader}>
        <Button
          className={css.detailBack}
          icon={<IconArrowLeft size={14} />}
          onClick={close}
          size="sm"
          variant="ghost"
        >
          {t('back-to-results')}
        </Button>

        <div className={css.detailHero}>
          <div className={css.detailIdentity}>
            <div className={css.detailIconSeat}>
              {getCategoryIcon(plugin.category, 20)}
            </div>
            <div className={css.detailNaming}>
              <h2 className={css.detailHeading}>{plugin.title}</h2>
              <div className={css.detailClassification}>
                <span className={css.detailCategory}>{plugin.category}</span>
                <span className={css.detailMechanism}>{mechanismLabel(plugin, t)}</span>
              </div>
            </div>
          </div>

          <div className={css.detailActions}>
            {action !== null && plan === null && !hasPreview && (
              <Button
                variant={action === 'update' || action === 'install' ? 'primary' : 'outline'}
                size="sm"
                disabled={pending}
                onClick={() => { runPlan(action) }}
              >
                {t(`action.${action}`)}
              </Button>
            )}

            {plugin.installed && plan === null && !hasPreview && (
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => { runPlan(plugin.enabled ? 'disable' : 'enable') }}
              >
                {plugin.enabled ? t('disable') : t('enable')}
              </Button>
            )}

            {plan !== null && plan.execution === 'installable' && !hasPreview && (
              <div className={css.planBtns}>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={pending || !ready || request !== null}
                  onClick={() => { runExecute('direct') }}
                >
                  {t('install-direct')}
                </Button>
                {plan.previewAvailable && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending || !ready}
                    onClick={() => { runExecute('preview') }}
                  >
                    {t('try-preview')}
                  </Button>
                )}
              </div>
            )}

            {hasPreview && <span className={css.previewTag}>{t('preview-in-progress')}</span>}

            <span ref={moreAnchorRef} className={css.menuAnchor}>
              <ToolbarAction
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                className={css.moreBtn}
                icon={<IconDots size={14} />}
                label={t('more-actions')}
                onClick={() => { setMenuOpen(current => !current) }}
              />
              <Menu
                open={menuOpen}
                anchor={null}
                portal
                getAnchorRect={() => moreAnchorRef.current?.getBoundingClientRect() ?? null}
                items={menuItems}
                onSelect={id => {
                  setMenuOpen(false)
                  if (id === 'open-repository') void bridge.openExternal(plugin.url)
                  if (id === 'uninstall') runPlan('uninstall')
                }}
                onClose={() => { setMenuOpen(false) }}
              />
            </span>
          </div>
        </div>
        <div className={css.detailStats}>
          <span><IconStar size={13} /> {formatMarketplaceCount(plugin.stars)}</span>
          <span><IconDownload size={13} /> {formatMarketplaceCount(plugin.downloads)}</span>
        </div>
      </header>

      {/* Detail Scrollable Body */}
      <div className={css.detailScroll}>
        {/* Planning / Execution Box */}
        {plan !== null && (
          <div className={css.planBox} aria-labelledby="marketplace-plan-title">
            <div className={css.planBoxHead}>
              <span id="marketplace-plan-title" className={css.planBoxTitle}>
                {t('plan-title', { action: t(`action.${plan.action}`) })}
              </span>
              <span className={css.riskBadge} data-risk={plan.riskLevel}>
                {t(`risk-level.${plan.riskLevel}`)}
              </span>
            </div>

            {plan.riskReasons.length > 0 && (
              <ul className={css.riskList}>
                {plan.riskReasons.map(reason => (
                  <li key={reason}>{riskReasonLabel(reason, t)}</li>
                ))}
              </ul>
            )}

            {plan.execution !== 'installable' && (
              <div className={css.planError}>{t('plan-not-installable')}</div>
            )}

            {hasScripts && (
              <pre className={css.scripts}>
                {Object.entries(plan.buildScripts).map(([name, script]) => `${name}: ${script}`).join('\n')}
              </pre>
            )}

            {requiredConfirmations.length > 0 && (
              <div className={css.confirms}>
                <span className={css.confirmTitle}>{t('confirm-before-install')}</span>
                {requiredConfirmations.map(requirement => (
                  <label className={css.confirmLabel} key={requirement}>
                    <input
                      checked={confirmations.includes(requirement)}
                      onChange={event => { selectConfirmation(requirement, event.target.checked) }}
                      type="checkbox"
                    />
                    <span>{confirmationLabel(requirement, t)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Input prompt */}
        {request !== null && (
          <div className={css.inputBox}>
            <strong>{t('configuration-required')}</strong>
            <p>{t('configuration-help')}</p>
            <div className={css.inputItems}>
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
          </div>
        )}

        {/* Description */}
        <p className={css.descFull}>
          {localizedDescription(plugin, localeTag(locale))}
        </p>

        {/* Screenshots */}
        {images.length > 0 && (
          <div className={css.screenshots} aria-label={t('screenshots')}>
            {images.map(image => (
              <img key={image} src={image} alt="" loading="lazy" className={css.screenshot} />
            ))}
          </div>
        )}

        {/* Readme Summary */}
        {plugin.readmeSummary !== null && (
          <div className={css.readme}>
            <div className={css.readmeText}>{plugin.readmeSummary}</div>
          </div>
        )}

        {/* Facts List */}
        <div className={css.facts}>
          <div className={css.factItem}>
            <span className={css.factKey}>{t('compatibility')}</span>
            <span className={css.factVal}>
              <span className={css.dotStatus} data-tone={compatibilityTone(plugin.compatibility.status)} />
              {compatibilityLabel(plugin.compatibility.status, t)}
            </span>
          </div>
          <div className={css.factItem}>
            <span className={css.factKey}>{t('trust')}</span>
            <span className={css.factVal}>{t(`trust.${plugin.trust}`)}</span>
          </div>
          <div className={css.factItem}>
            <span className={css.factKey}>{t('runtime-boundary')}</span>
            <span className={css.factVal}>{runtimeRiskLabel(plugin, t)}</span>
          </div>
          <div className={css.factItem}>
            <span className={css.factKey}>{t('channel')}</span>
            <span className={css.factVal}>{plugin.preferredChannel ?? 'github'}</span>
          </div>
          {plugin.version !== null && (
            <div className={css.factItem}>
              <span className={css.factKey}>{t('version')}</span>
              <span className={css.factVal}>{plugin.version}</span>
            </div>
          )}
          {plugin.repository !== null && (
            <div className={css.factItem}>
              <span className={css.factKey}>{t('repository')}</span>
              <button
                className={css.link}
                onClick={() => { void bridge.openExternal(plugin.url) }}
                type="button"
              >
                {plugin.repository}
                <IconExternalLink size={12} />
              </button>
            </div>
          )}
          {plugin.pushedAt !== null && (
            <div className={css.factItem}>
              <span className={css.factKey}>{t('updated')}</span>
              <span className={css.factVal}>{new Date(plugin.pushedAt).toLocaleDateString(localeTag(locale))}</span>
            </div>
          )}
          {plugin.latestCommit !== null && (
            <div className={css.factItem}>
              <span className={css.factKey}>{t('latest-commit')}</span>
              <span className="font-mono">{shortCommit(plugin.latestCommit)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
