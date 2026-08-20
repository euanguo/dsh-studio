import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from './cn.ts'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyMedia,
  EmptyHeader,
  EmptyTitle,
} from './empty.tsx'
import { StatusLine } from './status-line.tsx'

export type FeedbackStateKind = 'loading' | 'error' | 'empty'
export type FeedbackStateLayout = 'compact' | 'centered'

export type FeedbackStateProps = Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'children'> & {
  kind: FeedbackStateKind
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  indicator?: ReactNode
  layout?: FeedbackStateLayout
}

/**
 * Shared loading, error, and empty composition. Buttons, icons, and status
 * dots stay in the caller so official DSH primitives remain directly owned by
 * each plugin.
 */
export function FeedbackState({
  kind,
  title,
  description,
  action,
  indicator,
  layout = 'compact',
  className,
  ...props
}: FeedbackStateProps): JSX.Element {
  if (kind === 'empty') {
    return (
      <Empty data-slot="feedback-state" data-kind="empty" data-layout={layout} className={cn('dsh-studio-ui-feedback-state', className)} {...props}>
        {indicator !== undefined && <EmptyMedia variant="icon">{indicator}</EmptyMedia>}
        <EmptyHeader>
          <EmptyTitle>{title}</EmptyTitle>
          {description !== undefined && description !== null && description !== '' && (
            <EmptyDescription>{description}</EmptyDescription>
          )}
        </EmptyHeader>
        {action !== undefined && <EmptyContent>{action}</EmptyContent>}
      </Empty>
    )
  }

  return (
    <StatusLine
      data-slot="feedback-state"
      data-kind={kind}
      tone={kind}
      indicator={indicator}
      action={action}
      className={cn('dsh-studio-ui-feedback-state', className)}
      {...props}
    >
      <span className="dsh-studio-ui-feedback-state-title">{title}</span>
      {description !== undefined && description !== null && description !== '' && (
        <span className="dsh-studio-ui-feedback-state-description">{description}</span>
      )}
    </StatusLine>
  )
}

export function LoadingState({ label, ...props }: Omit<FeedbackStateProps, 'kind' | 'title'> & { label: ReactNode }): JSX.Element {
  return <FeedbackState kind="loading" title={label} {...props} />
}

export function ErrorState({ message, ...props }: Omit<FeedbackStateProps, 'kind' | 'title'> & { message: ReactNode }): JSX.Element {
  return <FeedbackState kind="error" title={message} {...props} />
}

export function EmptyState(props: Omit<FeedbackStateProps, 'kind' | 'title'> & { title: ReactNode }): JSX.Element {
  return <FeedbackState kind="empty" {...props} />
}
