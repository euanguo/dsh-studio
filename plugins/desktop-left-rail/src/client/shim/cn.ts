/**
 * Minimal class composition for the forked ui-workspace code, delegating to
 * `clsx`. Kept as its own module so the forked components import a local
 * name instead of reaching into @dsh-studio/shared.
 */
import { clsx } from 'clsx'

export const cn = clsx
export default cn