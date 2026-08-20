/**
 * Unified loading / error / empty status views. All copy arrives
 * pre-translated from call sites — the components stay i18n-agnostic.
 */
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@dsh-studio/shared/ui'

export function LoadingView({ label }: { label: string }): JSX.Element {
  return (
    <div className="dsh-studio-side-muted dsh-studio-status" data-kind="loading" role="status">
      {label}
    </div>
  )
}

/**
 * Either a plain error message, or a retryable one where the retry label is
 * required (pre-translated by the call site — no i18n inside the kit).
 */
export type ErrorViewProps =
  | { message: string; onRetry: () => void; retryLabel: string }
  | { message: string; onRetry?: undefined; retryLabel?: undefined }

export function ErrorView({ message, onRetry, retryLabel }: ErrorViewProps): JSX.Element {
  return (
    <div className="dsh-studio-side-error dsh-studio-status" data-kind="error" role="alert">
      <span className="dsh-studio-status-message">{message}</span>
      {onRetry !== undefined && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
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
    <Empty className="dsh-studio-side-muted dsh-studio-status" data-kind="empty">
      <EmptyHeader>
        <EmptyTitle className="dsh-studio-status-title">{title}</EmptyTitle>
        {description !== undefined && (
          <EmptyDescription className="dsh-studio-status-description">{description}</EmptyDescription>
        )}
      </EmptyHeader>
    </Empty>
  )
}
