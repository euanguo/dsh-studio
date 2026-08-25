/** Plugin detail dialog: facts, prepared-plan review (risk, build scripts,
 *  required confirmations) and the action buttons driving the preview flow. */
import { useEffect, useState } from 'react'
import {
  Button,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { LocaleService, Translate } from '@dsh-studio/shared/i18n'
import { localeTag } from '@dsh-studio/shared/i18n'
import type { DesktopBridge } from '@dsh-studio/shared/desktop-contracts'
import type {
  MarketplaceCommand,
  MarketplaceConfirmation,
  MarketplacePlugin,
  MarketplaceSnapshot,
} from '../protocol.ts'
import type { MarketplaceMessage } from './i18n.ts'
import {
  confirmationLabel,
  pluginMeta,
  riskReasonLabel,
  runtimeRiskLabel,
  shortCommit,
} from './marketplace-meta.ts'

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
  const plan = snapshot.plan?.pluginId === plugin.id ? snapshot.plan : null
  const approval = snapshot.approval
  const requiredConfirmations = approval?.requiredConfirmations ?? plan?.requirements ?? []
  const hasScripts = plan !== null && Object.keys(plan.buildScripts).length > 0
  const readyToPreview = plan !== null
    && requiredConfirmations.every(requirement => confirmations.includes(requirement))
  useEffect(() => { setConfirmations([]) }, [plugin.id, plan?.resolvedCommit])
  const setConfirmed = (
    confirmation: MarketplaceConfirmation,
    confirmed: boolean,
  ): void => {
    setConfirmations(current => confirmed
      ? [...new Set([...current, confirmation])]
      : current.filter(entry => entry !== confirmation))
  }
  const actions = (
    <div className={"oh-marketplace-detail-actions"}>
      {plugin.mechanism === 'unsupported' || plugin.protected ? (
        <Button variant="outline" size="sm" onClick={() => { void bridge.openExternal(plugin.url) }}>
          {t('open-repository')}
        </Button>
      ) : plan === null ? (
        <>
          {!plugin.installed && (
            <Button
              variant="primary"
              size="sm"
              disabled={pending}
              onClick={() => { void run({
                type: 'prepare',
                action: 'install',
                pluginId: plugin.id,
              }) }}
            >
              {t('preview.install')}
            </Button>
          )}
          {plugin.installed && plugin.updateAvailable && (
            <Button
              variant="primary"
              size="sm"
              disabled={pending}
              onClick={() => { void run({
                type: 'prepare',
                action: 'update',
                pluginId: plugin.id,
              }) }}
            >
              {t('preview.update')}
            </Button>
          )}
          {plugin.installed && (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => { void run({
                type: 'prepare',
                action: plugin.enabled ? 'disable' : 'enable',
                pluginId: plugin.id,
              }) }}
            >
              {plugin.enabled ? t('preview.disable') : t('preview.enable')}
            </Button>
          )}
          {plugin.installed && (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => { void run({
                type: 'prepare',
                action: 'uninstall',
                pluginId: plugin.id,
              }) }}
            >
              {t('preview.uninstall')}
            </Button>
          )}
        </>
      ) : snapshot.preview === null ? (
        <Button
          variant="primary"
          size="sm"
          disabled={pending || !readyToPreview}
          onClick={() => { void run({ type: 'preview', confirmations }) }}
        >
          {t('preview.launch')}
        </Button>
      ) : null}
      <Button variant="outline" size="sm" onClick={() => { void bridge.openExternal(plugin.url) }}>
        {t('view-source')}
      </Button>
    </div>
  )
  return (
    <Modal
      open
      onClose={close}
      title={plugin.title}
      description={pluginMeta(plugin, t)}
      closeLabel={t('close')}
      className={"oh-marketplace-dialog"}
      contentClassName="oh-marketplace-dialog-content"
      footer={actions}
    >
      <div className={"oh-marketplace-detail"} aria-label={t('details', { plugin: plugin.title })}>
        <p className={"oh-marketplace-detail-copy"}>{plugin.description}</p>
        <dl className={"oh-marketplace-facts"}>
          <dt>{t('updated')}</dt>
          <dd>
            {plugin.pushedAt === null
              ? t('unknown')
              : new Date(plugin.pushedAt).toLocaleString(localeTag(locale))}
          </dd>
          <dt>{t('repository')}</dt>
          <dd>{plugin.url.replace('https://github.com/', '')}</dd>
          <dt>{t('trust')}</dt>
          <dd>{t(`trust.${plugin.trust}`)}</dd>
          <dt>{t('runtime-boundary')}</dt>
          <dd>{runtimeRiskLabel(plugin, t)}</dd>
          {plugin.currentCommit !== null && (
            <>
              <dt>{t('current-commit')}</dt>
              <dd>{shortCommit(plugin.currentCommit)}</dd>
            </>
          )}
          {plugin.latestCommit !== null && (
            <>
              <dt>{t('latest-commit')}</dt>
              <dd>{shortCommit(plugin.latestCommit)}</dd>
            </>
          )}
        </dl>
        {plan !== null && (
          <section className={"oh-marketplace-plan"}>
            <h3>{t('prepared-plan', { action: t(`action.${plan.action}`) })}</h3>
            <div className={"oh-marketplace-flow"} aria-label={t('prepared-plan', { action: t(`action.${plan.action}`) })}>
              <span data-active="true">1 · {t('flow.review')}</span>
              <span data-active={String(snapshot.preview !== null)}>2 · {t('flow.preview')}</span>
              <span>3 · {t('flow.apply')}</span>
            </div>
            <dl className={"oh-marketplace-facts"}>
              <dt>{t('risk-level')}</dt>
              <dd data-risk={approval?.riskLevel ?? plan.riskLevel}>{t(`risk-level.${approval?.riskLevel ?? plan.riskLevel}`)}</dd>
              <dt>{t('source-review')}</dt>
              <dd>{t(`source-review.${plan.sourceReview}`)}</dd>
              <dt>{t('repository')}</dt>
              <dd>{plan.source}</dd>
              <dt>{t('latest-commit')}</dt>
              <dd>{shortCommit(plan.resolvedCommit)}</dd>
            </dl>
            {plan.packageName !== null && (
              <p className={"oh-marketplace-plan-line"}>{t('package', { package: plan.packageName })}</p>
            )}
            {plan.riskReasons.length > 0 && (
              <ul className={"oh-marketplace-risk-reasons"}>
                {plan.riskReasons.map(reason => (
                  <li key={reason}>{riskReasonLabel(reason, t)}</li>
                ))}
              </ul>
            )}
            {hasScripts && (
              <pre className={"oh-marketplace-scripts"}>
                {Object.entries(plan.buildScripts).map(([name, script]) => `${name}: ${script}`).join('\n')}
              </pre>
            )}
            {requiredConfirmations.map(requirement => (
              <label className={"oh-marketplace-confirm"} key={requirement}>
                <input
                  checked={confirmations.includes(requirement)}
                  onChange={event => { setConfirmed(requirement, event.target.checked) }}
                  type="checkbox"
                />
                <span>{confirmationLabel(requirement, t)}</span>
              </label>
            ))}
            <p className={"oh-marketplace-recovery-note"}>{t('recovery-note')}</p>
          </section>
        )}
      </div>
    </Modal>
  )
}