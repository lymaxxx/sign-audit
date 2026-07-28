import { cleanTimes, floorHour, type Minutes } from '../model/time'
import type { SegmentRules } from '../model/template'

export type SectionKind = 'times' | 'hourly' | 'interval'

interface SectionBase {
  /** Start of the stretch of day this section covers. */
  from: Minutes
  /** End of the stretch. Interval sections share this edge with the next one. */
  to: Minutes
  /** Every departure the section owns. Kept on all kinds so a section can be
   *  reclassified by hand without going back to the source data. */
  times: Minutes[]
  /** Set when this section was split off the front or back of a headway, which
   *  is what entitles it to be called the day's first or last departures. */
  peeled?: 'first' | 'last'
}

export interface TimesSection extends SectionBase {
  kind: 'times'
}

export interface HourlySection extends SectionBase {
  kind: 'hourly'
}

export interface IntervalSection extends SectionBase {
  kind: 'interval'
  /** Shortest and longest headway observed in the stretch. Equal values print
   *  as a single figure rather than a range. */
  min: number
  max: number
}

export type Section = TimesSection | HourlySection | IntervalSection

/** A run of consecutive departures sharing one rhythm. */
interface Run {
  /** Index of the first departure the run owns. */
  start: number
  /** Index of the last departure the run owns, inclusive. */
  end: number
  /** Headways inside the run. Empty for a run of a single departure. */
  headways: number[]
  /** The departure the rhythm runs up to — one past `end` where it exists. */
  reach: number
}

/**
 * Split departures into runs of homogeneous headway.
 *
 * A run grows while the spread between its longest and shortest headway stays
 * within tolerance. Each run owns departures `[start, end]`; the departure that
 * closes its rhythm belongs to the next run, so nothing is printed twice.
 */
const findRuns = (times: Minutes[], rules: SegmentRules): Run[] => {
  const n = times.length
  if (n === 0) return []
  if (n === 1) return [{ start: 0, end: 0, headways: [], reach: 0 }]

  const headways: number[] = []
  for (let i = 0; i < n - 1; i++) headways.push(times[i + 1]! - times[i]!)

  const runs: Run[] = []
  let startIdx = 0
  let current: number[] = [headways[0]!]

  const settled = () => median(current.filter((h) => h > 0))

  for (let i = 1; i < headways.length; i++) {
    const h = headways[i]!
    const rhythm = settled()
    const allowed = Math.max(rules.headwayTolerance, rhythm * rules.headwayToleranceRatio)

    // Part of the rhythm, or a trip that simply was not run — either way the
    // run carries on. Only a gap that is neither ends it.
    const fits = Math.abs(h - rhythm) <= allowed
    const multiple = rhythm > 0 ? Math.round(h / rhythm) : 0
    const skipped = multiple >= 2 && multiple <= 4 && Math.abs(h - rhythm * multiple) <= allowed

    if (fits || skipped) {
      current.push(h)
      continue
    }

    runs.push({ start: startIdx, end: i - 1, headways: headways.slice(startIdx, i), reach: i })
    startIdx = i
    current = [h]
  }

  runs.push({ start: startIdx, end: n - 1, headways: headways.slice(startIdx), reach: n - 1 })
  return runs
}


export const median = (xs: number[]): number => {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

export interface HeadwayReading {
  /** Gaps that belong to the rhythm, with missing trips left out. */
  regular: number[]
  /** Gaps that read as a trip simply not being run. */
  missing: number
  /** Gaps that break the rhythm outright. */
  broken: number
  median: number
  /** True when the rhythm is tight enough to quote as a single headway. */
  steady: boolean
}

/**
 * Read a run of gaps as a headway.
 *
 * Real timetables are not tidy. A line running every 30 minutes will have an
 * hour-long hole in the middle of the day where one trip is not run, and a
 * naive reading breaks the day in half there and quotes "every 20-60 minutes"
 * — neither of which is what the service does. A gap close to a whole multiple
 * of the prevailing headway is therefore read as a missing trip: it does not
 * end the run, and it does not enter the range that gets printed.
 */
export const readHeadways = (gaps: number[], rules: SegmentRules): HeadwayReading => {
  if (gaps.length === 0) return { regular: [], missing: 0, broken: 0, median: 0, steady: false }

  const mid = median(gaps)
  const allowed = Math.max(rules.headwayTolerance, mid * rules.headwayToleranceRatio)

  const regular: number[] = []
  let missing = 0
  let broken = 0

  for (const gap of gaps) {
    if (Math.abs(gap - mid) <= allowed) {
      regular.push(gap)
      continue
    }
    // Two, three or four times the rhythm is a trip that did not run.
    const multiple = Math.round(gap / mid)
    if (multiple >= 2 && multiple <= 4 && Math.abs(gap - mid * multiple) <= allowed) missing++
    else broken++
  }

  // Distance from the median admits a missing trip; the spread of what is left
  // is what decides whether this reads as one headway. Judging only by the
  // former would let a service wandering between 15 and 45 minutes pass as
  // "every 30", which is not a rhythm anyone can wait on.
  const spread = regular.length > 0 ? Math.max(...regular) - Math.min(...regular) : Infinity
  const steady = spread <= allowed

  return { regular, missing, broken, median: mid, steady }
}

/** Does this run read as regular service rather than a handful of departures? */
const qualifiesAsInterval = (run: Run, times: Minutes[], rules: SegmentRules): boolean => {
  const tripCount = run.reach - run.start + 1
  if (tripCount < rules.minTripsForInterval) return false
  if (run.headways.length === 0) return false

  const reading = readHeadways(run.headways, rules)
  if (reading.regular.length === 0 || !reading.steady) return false
  // A stray hole is tolerable; a run that is mostly holes is not a headway.
  if (reading.missing > reading.regular.length / 3) return false

  // Judged on the median rather than the mean, so one long gap cannot drag a
  // clear 30-minute service past the threshold that admits it.
  if (reading.median > rules.maxHeadwayForInterval) return false

  const span = times[run.reach]! - times[run.start]!
  if (span < rules.minSpanForInterval) return false
  return true
}

const makeInterval = (run: Run, times: Minutes[], rules: SegmentRules): IntervalSection => {
  let from = times[run.start]!
  let to = times[run.reach]!
  if (rules.snapBoundariesToHour) {
    const snappedFrom = floorHour(from)
    const snappedTo = floorHour(to)
    if (snappedTo > snappedFrom) {
      from = snappedFrom
      to = snappedTo
    }
  }
  return {
    kind: 'interval',
    from,
    to,
    // The quoted range covers the rhythm, not the holes in it: printing
    // "every 20-60 minutes" because one trip was missed helps nobody.
    min: Math.min(...readHeadways(run.headways, rules).regular),
    max: Math.max(...readHeadways(run.headways, rules).regular),
    times: times.slice(run.start, run.end + 1),
  }
}

const makeIrregular = (owned: Minutes[], rules: SegmentRules): TimesSection | HourlySection => ({
  kind: owned.length >= rules.hourlyThreshold ? 'hourly' : 'times',
  from: owned[0]!,
  to: owned[owned.length - 1]!,
  times: owned,
})

/**
 * Peel the opening or closing departures of the service day out of an interval
 * section, so a sheet can print "first departures 05:37 05:54" above the
 * headway rather than burying them in it.
 */
export const peelEdges = (sections: Section[], rules: SegmentRules): Section[] => {
  const out = [...sections]

  const first = out[0]
  if (first && first.kind === 'interval' && rules.firstTripsCount > 0) {
    const take = Math.min(rules.firstTripsCount, Math.max(0, first.times.length - rules.minTripsForInterval))
    if (take > 0) {
      const taken = first.times.slice(0, take)
      const rest = first.times.slice(take)
      out[0] = { ...first, times: rest, from: rest[0] ?? first.from }
      out.unshift({ kind: 'times', from: taken[0]!, to: taken[taken.length - 1]!, times: taken, peeled: 'first' })
    }
  }

  const lastIdx = out.length - 1
  const last = out[lastIdx]
  if (last && last.kind === 'interval' && rules.lastTripsCount > 0) {
    const take = Math.min(rules.lastTripsCount, Math.max(0, last.times.length - rules.minTripsForInterval))
    if (take > 0) {
      const taken = last.times.slice(last.times.length - take)
      const rest = last.times.slice(0, last.times.length - take)
      out[lastIdx] = { ...last, times: rest, to: rest[rest.length - 1] ?? last.to }
      out.push({ kind: 'times', from: taken[0]!, to: taken[taken.length - 1]!, times: taken, peeled: 'last' })
    }
  }

  return out
}

/**
 * Work out how a day of departures should be presented.
 *
 * Stretches of regular service become headways; the irregular remainder
 * becomes a departure list, or an hour-by-hour grid once it gets long. A
 * typical urban line falls out as scattered early departures, a headway
 * through the day, and scattered departures again at night — which is the
 * shape these sheets have always had.
 */
export const segmentDayCore = (raw: Minutes[], rules: SegmentRules): Section[] => {
  const times = cleanTimes(raw)
  if (times.length === 0) return []
  if (times.length === 1) {
    return [{ kind: 'times', from: times[0]!, to: times[0]!, times }]
  }

  const runs = findRuns(times, rules)
  const sections: Section[] = []
  let pending: Minutes[] = []

  const flushPending = () => {
    if (pending.length === 0) return
    sections.push(makeIrregular(pending, rules))
    pending = []
  }

  for (const run of runs) {
    if (qualifiesAsInterval(run, times, rules)) {
      flushPending()
      sections.push(makeInterval(run, times, rules))
    } else {
      for (let i = run.start; i <= run.end; i++) pending.push(times[i]!)
    }
  }
  flushPending()

  // The closing departure is owned by the final run only when that run is
  // irregular; an interval run reaches it without printing it, so put it back.
  const lastSection = sections[sections.length - 1]
  if (lastSection && lastSection.kind === 'interval') {
    const finalTime = times[times.length - 1]!
    if (!lastSection.times.includes(finalTime)) {
      lastSection.times = [...lastSection.times, finalTime]
    }
  }

  return sections
}

/** Segment a single day, including the peeled first and last departures. */
export const segmentDay = (raw: Minutes[], rules: SegmentRules): Section[] =>
  peelEdges(segmentDayCore(raw, rules), rules)
