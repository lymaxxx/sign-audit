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
const findRuns = (times: Minutes[], tolerance: number, toleranceRatio: number): Run[] => {
  const n = times.length
  if (n === 0) return []
  if (n === 1) return [{ start: 0, end: 0, headways: [], reach: 0 }]

  const headways: number[] = []
  for (let i = 0; i < n - 1; i++) headways.push(times[i + 1]! - times[i]!)

  const runs: Run[] = []
  let startIdx = 0
  let lo = headways[0]!
  let hi = headways[0]!
  let sum = headways[0]!
  let count = 1

  for (let i = 1; i < headways.length; i++) {
    const h = headways[i]!
    const nextLo = Math.min(lo, h)
    const nextHi = Math.max(hi, h)
    // Allowance grows with the headway itself: a 20-minute service that
    // wanders by 8 minutes is as regular as a 5-minute one wandering by 2.
    const allowed = Math.max(tolerance, ((sum + h) / (count + 1)) * toleranceRatio)
    if (nextHi - nextLo <= allowed) {
      lo = nextLo
      hi = nextHi
      sum += h
      count++
      continue
    }
    // Rhythm broke at headway i: the run owns departures up to i-1, and its
    // rhythm reaches departure i.
    runs.push({ start: startIdx, end: i - 1, headways: headways.slice(startIdx, i), reach: i })
    startIdx = i
    lo = h
    hi = h
    sum = h
    count = 1
  }

  runs.push({
    start: startIdx,
    end: n - 1,
    headways: headways.slice(startIdx),
    reach: n - 1,
  })
  return runs
}

const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length)

/** Does this run read as regular service rather than a handful of departures? */
const qualifiesAsInterval = (run: Run, times: Minutes[], rules: SegmentRules): boolean => {
  const tripCount = run.reach - run.start + 1
  if (tripCount < rules.minTripsForInterval) return false
  if (run.headways.length === 0) return false
  const avg = mean(run.headways)
  if (avg > rules.maxHeadwayForInterval) return false
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
    min: Math.min(...run.headways),
    max: Math.max(...run.headways),
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

  const runs = findRuns(times, rules.headwayTolerance, rules.headwayToleranceRatio)
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
