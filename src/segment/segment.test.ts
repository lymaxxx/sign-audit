import { describe, expect, it } from 'vitest'
import { segmentDay, segmentDayTypes } from './index'
import { defaultRules } from '../model/defaults'
import { parseTimeList } from '../model/time'
import type { SegmentRules } from '../model/template'

const rules = (over: Partial<SegmentRules> = {}): SegmentRules => ({ ...defaultRules(), ...over })

/** Departures every `step` minutes from `from` to `to`, inclusive. */
const every = (from: string, to: string, step: number): number[] => {
  const [fh, fm] = from.split(':').map(Number) as [number, number]
  const [th, tm] = to.split(':').map(Number) as [number, number]
  const out: number[] = []
  for (let t = fh * 60 + fm; t <= th * 60 + tm; t += step) out.push(t)
  return out
}

describe('segmentDay', () => {
  it('returns nothing for an empty day', () => {
    expect(segmentDay([], rules())).toEqual([])
  })

  it('keeps a handful of departures as a plain list', () => {
    const times = parseTimeList('07:10 08:40 10:56 12:26 14:16')
    const sections = segmentDay(times, rules())
    expect(sections).toHaveLength(1)
    expect(sections[0]!.kind).toBe('times')
    expect(sections[0]!.times).toEqual(times)
  })

  it('reads steady service as a headway', () => {
    const sections = segmentDay(every('06:00', '19:00', 10), rules({ firstTripsCount: 0, lastTripsCount: 0 }))
    expect(sections).toHaveLength(1)
    const s = sections[0]!
    expect(s.kind).toBe('interval')
    if (s.kind === 'interval') {
      expect(s.min).toBe(10)
      expect(s.max).toBe(10)
    }
  })

  it('reports a headway range when the rhythm wobbles', () => {
    // 8, 10, 8, 10 … stays inside tolerance and reads as "every 8-10".
    const times: number[] = [6 * 60]
    for (let i = 0; i < 40; i++) times.push(times[times.length - 1]! + (i % 2 === 0 ? 8 : 10))
    const sections = segmentDay(times, rules({ firstTripsCount: 0, lastTripsCount: 0 }))
    expect(sections).toHaveLength(1)
    const s = sections[0]!
    expect(s.kind).toBe('interval')
    if (s.kind === 'interval') {
      expect(s.min).toBe(8)
      expect(s.max).toBe(10)
    }
  })

  it('splits a mixed day into scattered morning, headway, scattered evening', () => {
    const morning = parseTimeList('05:12 05:41 06:20')
    const midday = every('07:00', '19:00', 10)
    const evening = parseTimeList('19:40 20:35 21:38 22:50 23:55')
    const sections = segmentDay(
      [...morning, ...midday, ...evening],
      rules({ firstTripsCount: 0, lastTripsCount: 0 }),
    )

    expect(sections.map((s) => s.kind)).toEqual(['times', 'interval', 'times'])
    expect(sections[0]!.times[0]).toBe(5 * 60 + 12)
    expect(sections[2]!.times.at(-1)).toBe(23 * 60 + 55)
  })

  it('snaps headway boundaries to whole hours', () => {
    const times = every('06:11', '19:03', 11)
    const sections = segmentDay(times, rules({ firstTripsCount: 0, lastTripsCount: 0 }))
    const interval = sections.find((s) => s.kind === 'interval')!
    expect(interval.from).toBe(6 * 60)
    expect(interval.to).toBe(19 * 60)
  })

  it('leaves boundaries alone when snapping is off', () => {
    const times = every('06:11', '19:03', 11)
    const sections = segmentDay(
      times,
      rules({ snapBoundariesToHour: false, firstTripsCount: 0, lastTripsCount: 0 }),
    )
    const interval = sections.find((s) => s.kind === 'interval')!
    expect(interval.from).toBe(6 * 60 + 11)
  })

  it('peels the first and last departures off a day that is all headway', () => {
    const sections = segmentDay(every('06:00', '19:00', 10), rules({ firstTripsCount: 2, lastTripsCount: 1 }))
    expect(sections.map((s) => s.kind)).toEqual(['times', 'interval', 'times'])
    expect(sections[0]!.times).toEqual([6 * 60, 6 * 60 + 10])
    expect(sections[2]!.times).toHaveLength(1)
  })

  it('does not peel when the day already opens with a departure list', () => {
    const times = [...parseTimeList('05:12 05:41 06:20'), ...every('07:00', '19:00', 10)]
    const sections = segmentDay(times, rules({ firstTripsCount: 2, lastTripsCount: 0 }))
    expect(sections.map((s) => s.kind)).toEqual(['times', 'interval'])
    expect(sections[0]!.times).toHaveLength(3)
  })

  it('switches a long irregular stretch to an hourly grid', () => {
    // Two departures an hour at unpredictable minutes: too many to list flat.
    const times: number[] = []
    for (let h = 6; h < 24; h++) {
      times.push(h * 60 + ((h * 7) % 30))
      times.push(h * 60 + 30 + ((h * 13) % 29))
    }
    const sections = segmentDay(times, rules({ hourlyThreshold: 20 }))
    expect(sections.some((s) => s.kind === 'hourly')).toBe(true)
  })

  it('never loses or duplicates a departure', () => {
    const times = [
      ...parseTimeList('05:12 05:41 06:20'),
      ...every('07:00', '19:00', 10),
      ...parseTimeList('19:40 20:35 21:38 22:50 23:55'),
    ]
    const sections = segmentDay(times, rules())
    const seen = sections.flatMap((s) => s.times)
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen.sort((a, b) => a - b)).toEqual(times.sort((a, b) => a - b))
  })

  it('keeps post-midnight departures at the end of the service day', () => {
    // 24:37 is 1477 minutes: the last trip of the night, not the first of the morning.
    const times = [...every('20:00', '23:00', 20), 24 * 60 + 37]
    const sections = segmentDay(times, rules({ firstTripsCount: 0, lastTripsCount: 0 }))
    const all = sections.flatMap((s) => s.times)
    expect(all.at(-1)).toBe(24 * 60 + 37)
  })
})

describe('real timetables are not tidy', () => {
  const at = (h: number, m: number) => h * 60 + m

  /** Every 30 minutes, but the 12:45 trip is not run. */
  const withHole = (): number[] => {
    const grid: Record<number, number[]> = {
      7: [20, 45], 8: [15, 45], 9: [15, 45], 10: [15, 45], 11: [15, 45], 12: [15],
      13: [15, 45], 14: [15, 45], 15: [15, 45], 16: [15, 45], 17: [15, 45],
      18: [15, 45], 19: [15, 45], 20: [5, 30], 21: [0],
    }
    return Object.entries(grid)
      .flatMap(([h, ms]) => ms.map((m) => at(Number(h), m)))
      .sort((a, b) => a - b)
  }

  it('reads through a single missing trip instead of splitting the day', () => {
    const sections = segmentDay(withHole(), rules())
    const intervals = sections.filter((s) => s.kind === 'interval')
    expect(intervals).toHaveLength(1)
  })

  it('keeps the hole out of the quoted range', () => {
    const sections = segmentDay(withHole(), rules())
    const interval = sections.find((s) => s.kind === 'interval')!
    // The gap where the trip is missing is 60 minutes; quoting it would say
    // "every 20-60 minutes" about a half-hourly service.
    if (interval.kind === 'interval') expect(interval.max).toBeLessThan(60)
  })

  it('judges the headway on the median, not the mean', () => {
    // One 60-minute hole drags the mean to 30.4 — just past a 30-minute limit
    // that the service itself sits exactly on.
    const sections = segmentDay(withHole(), rules({ maxHeadwayForInterval: 30 }))
    expect(sections.some((s) => s.kind === 'interval')).toBe(true)
  })

  it('still refuses a stretch that is mostly holes', () => {
    // 30, 90, 30, 120, 30 … is not a headway anybody can rely on.
    const times = [at(7, 0)]
    for (const gap of [30, 90, 30, 120, 30, 150, 30, 90]) {
      times.push(times[times.length - 1]! + gap)
    }
    const sections = segmentDay(times, rules())
    expect(sections.every((s) => s.kind !== 'interval')).toBe(true)
  })

  it('treats hourly service as a headway worth quoting', () => {
    const times = Array.from({ length: 14 }, (_, i) => at(7, 0) + i * 60)
    const sections = segmentDay(times, rules())
    const interval = sections.find((s) => s.kind === 'interval')
    expect(interval).toBeDefined()
    if (interval?.kind === 'interval') expect(interval.min).toBe(60)
  })
})

describe('segmenting several kinds of day together', () => {
  // A weekday alternating 15/30 (a couple of 15-minute slots dropped through
  // the day) beside a sparser, less regular weekend — the shape that showed
  // up as a raw hourly grid next to the weekend's own correctly-read headway,
  // because the shared-window reading used a stricter, stale copy of the
  // single-day broken-gap guard.
  const weekday = parseTimeList(
    '07:23 07:48 ' +
      '08:03 08:18 08:48 09:18 09:48 ' +
      '10:17 10:32 10:47 11:17 11:32 11:47 12:17 12:32 12:47 13:17 13:32 13:47 14:17 14:32 14:47 ' +
      '15:18 15:33 15:48 16:18 16:33 16:48 17:18 17:33 17:48 18:18 18:48 19:18 19:48 ' +
      '20:07 20:32 21:02',
  )
  const weekend = parseTimeList(
    '08:48 09:10 09:35 10:00 10:28 10:50 11:15 11:40 12:05 12:30 12:58 13:20 13:48 14:12 14:40 ' +
      '15:05 15:30 15:58 16:20 16:48 17:10 17:38 18:02 18:30 18:55 19:20 19:48 20:10 20:38 21:02',
  )

  it('reads a weekday with a couple of dropped slots as the same headway as the weekend', () => {
    const [wd, we] = segmentDayTypes([weekday, weekend], rules())
    expect(wd!.some((s) => s?.kind === 'interval')).toBe(true)
    expect(wd!.some((s) => s?.kind === 'hourly')).toBe(false)
    expect(we!.some((s) => s?.kind === 'interval')).toBe(true)
  })

  it('lines up the interval row across both kinds of day', () => {
    const [wd, we] = segmentDayTypes([weekday, weekend], rules())
    const intervalRow = wd!.findIndex((s) => s?.kind === 'interval')
    expect(intervalRow).toBeGreaterThanOrEqual(0)
    expect(we![intervalRow]?.kind).toBe('interval')
  })
})
