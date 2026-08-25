import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
} from 'react'

import { cn } from './cn.ts'

export type ListRowProps = HTMLAttributes<HTMLDivElement> & {
  readonly selected?: boolean
  readonly active?: boolean
}

export function ListRow({
  className,
  selected = false,
  active = false,
  ...props
}: ListRowProps): JSX.Element {
  return (
    <div
      data-slot="list-row"
      data-selected={selected || undefined}
      data-active={active || undefined}
      className={cn('dsh-studio-list-row', className)}
      {...props}
    />
  )
}

export type ListRowMainProps = ButtonHTMLAttributes<HTMLButtonElement>

export function ListRowMain({
  className,
  type = 'button',
  ...props
}: ListRowMainProps): JSX.Element {
  return (
    <button
      data-slot="list-row-main"
      type={type}
      className={cn('dsh-studio-list-row-main', className)}
      {...props}
    />
  )
}

export function ListRowLeading({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>): JSX.Element {
  return <span data-slot="list-row-leading" className={cn('dsh-studio-list-row-leading', className)} {...props} />
}

export function ListRowBody({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>): JSX.Element {
  return <span data-slot="list-row-body" className={cn('dsh-studio-list-row-body', className)} {...props} />
}

export function ListRowLabel({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>): JSX.Element {
  return <span data-slot="list-row-label" className={cn('dsh-studio-list-row-label', className)} {...props} />
}

/** Truncating title text inside ListRowLabel when mixed with marks/actions. */
export function ListRowLabelText({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>): JSX.Element {
  return <span data-slot="list-row-label-text" className={cn('dsh-studio-list-row-label-text', className)} {...props} />
}

export function ListRowMeta({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>): JSX.Element {
  return <span data-slot="list-row-meta" className={cn('dsh-studio-list-row-meta', className)} {...props} />
}

export function ListRowTrailing({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div data-slot="list-row-trailing" className={cn('dsh-studio-list-row-trailing', className)} {...props} />
}

export function ListRowActions({
  className,
  alwaysVisible = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { readonly alwaysVisible?: boolean }): JSX.Element {
  return (
    <div
      data-slot="list-row-actions"
      data-hover-actions=""
      data-always-visible={alwaysVisible || undefined}
      className={cn('dsh-studio-list-row-actions', className)}
      {...props}
    />
  )
}

/** Dense icon control for row actions — no second hover wash. */
export function ListRowActionButton({
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return <button data-slot="list-row-action-button" type={type} className={cn('dsh-studio-list-row-action-button', className)} {...props} />
}
