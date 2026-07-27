/**
 * Service-day time arithmetic.
 *
 * Times are minutes since midnight of the *service day*, not the calendar day.
 * A 00:37 departure that belongs to the previous day's service is 1477, and
 * prints as `24:37`. Transit timetables have done this for a century; treating
 * it as 00:37 sorts the last trip of the night to the top of the list.
 */

export type Minutes = number

export const MINUTES_PER_HOUR = 60
export const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR

export const hourOf = (m: Minutes): number => Math.floor(m / MINUTES_PER_HOUR)
export const minuteOf = (m: Minutes): number => ((m % MINUTES_PER_HOUR) + MINUTES_PER_HOUR) % MINUTES_PER_HOUR

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n))

export interface TimeFormatOptions {
  /** Print 24:37 rather than 00:37 for post-midnight service. Default true. */
  postMidnightAsHour24?: boolean
  /** Separator between hour and minute. Default ":". */
  separator?: string
  /** Pad the hour to two digits. Default true. */
  padHour?: boolean
}

/** Normalise an hour for display, folding 24+ back to 0-23 when asked. */
const displayHour = (m: Minutes, asHour24: boolean): number => {
  const h = hourOf(m)
  if (asHour24) return h
  return h % 24
}

export const formatTime = (m: Minutes, opts: TimeFormatOptions = {}): string => {
  const { postMidnightAsHour24 = true, separator = ':', padHour = true } = opts
  const h = displayHour(m, postMidnightAsHour24)
  return `${padHour ? pad2(h) : String(h)}${separator}${pad2(minuteOf(m))}`
}

/** Just the hour part, for the hour column of an hourly section. */
export const formatHour = (m: Minutes, opts: TimeFormatOptions = {}): string => {
  const { postMidnightAsHour24 = true, padHour = true } = opts
  const h = displayHour(m, postMidnightAsHour24)
  return padHour ? pad2(h) : String(h)
}

/** Just the minute part, for the minutes of an hourly section. */
export const formatMinute = (m: Minutes): string => pad2(minuteOf(m))

/**
 * Parse a clock time into service-day minutes.
 *
 * Accepts `7:10`, `07:10`, `24:37`, `7.10`, `7 10` and bare `0710`. Returns
 * null for anything it does not recognise, so importers can report the row
 * rather than silently dropping a departure.
 */
export const parseTime = (raw: string): Minutes | null => {
  const s = raw.trim()
  if (!s) return null

  const sep = /^(\d{1,2})\s*[:.\-\s]\s*(\d{1,2})$/.exec(s)
  if (sep) {
    const h = Number(sep[1])
    const min = Number(sep[2])
    if (min > 59) return null
    return h * MINUTES_PER_HOUR + min
  }

  const bare = /^(\d{3,4})$/.exec(s)
  if (bare) {
    const digits = bare[1]!
    const h = Number(digits.slice(0, digits.length - 2))
    const min = Number(digits.slice(-2))
    if (min > 59) return null
    return h * MINUTES_PER_HOUR + min
  }

  return null
}

/**
 * Excel stores a time-of-day cell as a fraction of a day. Anything at or above
 * 1 carries a date part we do not care about, so only the fraction is kept.
 */
export const parseExcelTime = (value: number): Minutes | null => {
  if (!Number.isFinite(value) || value < 0) return null
  const frac = value % 1
  return Math.round(frac * MINUTES_PER_DAY)
}

/**
 * Pull every clock time out of a free-form string.
 * `"07:10 08:40, 10:56"` and `"0710 0840"` both yield three departures.
 */
export const parseTimeList = (raw: string): Minutes[] => {
  const out: Minutes[] = []
  for (const token of raw.split(/[^\d:.\-]+/)) {
    const t = parseTime(token)
    if (t !== null) out.push(t)
  }
  return out
}

/**
 * Sort and lift post-midnight departures onto the service day.
 *
 * A timetable listing `05:12 … 23:48 00:19 01:05` means the last two run after
 * midnight. Detected by a backwards jump in an otherwise ascending list; every
 * time after the jump gains 24 hours.
 */
export const normaliseServiceDay = (times: Minutes[]): Minutes[] => {
  if (times.length === 0) return []
  const out: Minutes[] = []
  let carry = 0
  let prev = -Infinity
  for (const t of times) {
    let v = t + carry
    // A drop of more than 12h reads as crossing midnight rather than as an
    // out-of-order row; a small drop is just unsorted input.
    if (prev !== -Infinity && v < prev - MINUTES_PER_DAY / 2) {
      carry += MINUTES_PER_DAY
      v = t + carry
    }
    out.push(v)
    prev = v
  }
  return out.sort((a, b) => a - b)
}

/** Deduplicate and sort, leaving service-day offsets intact. */
export const cleanTimes = (times: Minutes[]): Minutes[] => {
  const seen = new Set<Minutes>()
  const out: Minutes[] = []
  for (const t of times) {
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out.sort((a, b) => a - b)
}

/** Round down to the hour, for snapping segment boundaries. */
export const floorHour = (m: Minutes): Minutes => Math.floor(m / MINUTES_PER_HOUR) * MINUTES_PER_HOUR

/** Round up to the hour, for snapping segment boundaries. */
export const ceilHour = (m: Minutes): Minutes => Math.ceil(m / MINUTES_PER_HOUR) * MINUTES_PER_HOUR
