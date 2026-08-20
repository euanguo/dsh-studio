import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@dsh-studio/shared/ui'

/** Compatibility exports for sidebar extensions using the former status path. */
export function LoadingView({ label }: { label: string }): JSX.Element {
  return <LoadingState label={label} />
}

export type ErrorViewProps =
  | { message: string; onRetry: () => void; retryLabel: string }
  | { message: string; onRetry?: undefined; retryLabel?: undefined }

export function ErrorView({ message, onRetry, retryLabel }: ErrorViewProps): JSX.Element {
  return (
    <ErrorState
      message={message}
      action={onRetry === undefined ? undefined : (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    />
  )
}

export function EmptyView({ title, description }: { title: string; description?: string }): JSX.Element {
  return <EmptyState title={title} {...(description === undefined ? {} : { description })} />
}
