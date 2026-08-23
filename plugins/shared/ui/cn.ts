/**
 * Class composition helper (shadcn source convention), delegating to `clsx`.
 *
 * Previously hand-rolled; `clsx` is the canonical tiny (2.4 kB) classnames
 * combinator with identical semantics for the ClassValue union (strings,
 * falsy skips, arrays, conditional-object maps).
 */
import { clsx, type ClassValue } from 'clsx'

export const cn = clsx
export type { ClassValue }
export default cn