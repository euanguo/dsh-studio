/**
 * Relative-time bucketing shared across surfaces. The thresholds and
 * magnitude dividers mirror `desktop-left-rail/src/client/tree.ts`
 * (`relativeTime`), so any renderer that localizes these buckets produces the
 * same "now / 5min / 3h / 2d / 4mo / 1y" shapes.
 */

const MIN_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

/** A structured relative-time bucket magnitude and unit. */
export interface RelativeTimeParts {
  value: number
  unit: 'min' | 'hour' | 'day' | 'month' | 'year'
}

/**
 * Bucket an absolute point in time relative to now, matching the left-rail
 * `relativeTime` semantics. Boundaries (all durations since the timestamp):
 * - < 60s        → `{ value: 0, unit: 'min' }`  (the "now" bucket: magnitude 0)
 * - < 1h         → `min`, `floor(since / 60s)`
 * - < 1d         → `hour`, `floor(since / 1h)`
 * - < 30d        → `day`, `floor(since / 1d)`
 * - < 365d       → `month`, `floor(since / 30d)`
 * - otherwise    → `year`, `floor(since / 365d)`
 *
 * Returns null for an input that cannot be coerced to a valid timestamp
 * (invalid date strings, NaN, etc.). Future timestamps are clamped to the
 * origin, so their bucket is `min` at value 0.
 *
 * @param dateLike - an epoch-ms number, a date string parseable by `Date`, or
 *   a `Date` instance.
 */
export function relativeTimeParts(
  dateLike: string | number | Date,
): RelativeTimeParts | null {
  const timestamp = toTimestamp(dateLike)
  if (timestamp === null) return null

  const since = Math.max(0, Date.now() - timestamp)
  if (since < MIN_MS) return { value: 0, unit: 'min' }
  if (since < HOUR_MS) return { value: Math.floor(since / MIN_MS), unit: 'min' }
  if (since < DAY_MS) return { value: Math.floor(since / HOUR_MS), unit: 'hour' }
  if (since < 30 * DAY_MS) return { value: Math.floor(since / DAY_MS), unit: 'day' }
  if (since < 365 * DAY_MS) {
    return { value: Math.floor(since / (30 * DAY_MS)), unit: 'month' }
  }
  return { value: Math.floor(since / (365 * DAY_MS)), unit: 'year' }
}

function toTimestamp(dateLike: string | number | Date): number | null {
  let ms: number
  if (typeof dateLike === 'number') {
    ms = dateLike
  } else if (dateLike instanceof Date) {
    ms = dateLike.getTime()
  } else {
    ms = Date.parse(dateLike)
  }
  return Number.isFinite(ms) ? ms : null
}