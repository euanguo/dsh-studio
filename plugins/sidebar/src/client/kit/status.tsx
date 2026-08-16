/**
 * Unified loading / error / empty status views (plan P9.2). Every surface
 * and panel renders these instead of ad-hoc muted/error divs, so status
 * presentation stays consistent and gains the shared affordances (retry
 * button, title/description empty state) in one place. All copy arrives
 * pre-translated from call sites — the components stay i18n-agnostic.
 */

export function LoadingView({ label }: { label: string }): JSX.Element {
  return (
    <div className="oh-dsh-side-muted oh-dsh-status" data-kind="loading" role="status">
      {label}
    </div>
  )
}

export function ErrorView({
  message,
  onRetry,
  retryLabel,
}: {
  message: string
  onRetry?: () => void
  retryLabel?: string
}): JSX.Element {
  return (
    <div className="oh-dsh-side-error oh-dsh-status" data-kind="error" role="alert">
      <span className="oh-dsh-status-message">{message}</span>
      {onRetry !== undefined && (
        <button type="button" className="oh-dsh-status-retry" onClick={onRetry}>
          {retryLabel ?? 'Retry'}
        </button>
      )}
    </div>
  )
}

export function EmptyView({
  title,
  description,
}: {
  title: string
  description?: string
}): JSX.Element {
  return (
    <div className="oh-dsh-side-muted oh-dsh-status" data-kind="empty">
      <div className="oh-dsh-status-title">{title}</div>
      {description !== undefined && (
        <div className="oh-dsh-status-description">{description}</div>
      )}
    </div>
  )
}
