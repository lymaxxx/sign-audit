import { cleanTimes, floorHour, type Minutes } from '../model/time'
import type { SegmentRules } from '../model/template'
import { segmentDayCore, type Section } from './core'

/**
 * Segmenting every kind of day together, rather than one at a time.
 *
 * Analysed in isolation, a route's weekdays can come out as a headway while
 * its weekends come out as an hour-by-hour grid — comparable service, but one
 * wobbles a little more than the other. Laid side by side, those two answers
 * share no rows and the block fills with holes.
 *
 * So the *shape* of the day is settled once, from all kinds of day at once,
 * and each column is filled against that shared shape. Every column ends up
 * with the same number of slots in the same order, which is what lets blocks
 * line up with one another across the sheet. A slot a column has nothing for
 * stays empty rather than shifting the ones below it.
 */

interface Window {
  from: Minutes
  to: Minutes
}

/** A column's sections, aligned to the shared skeleton. */
export type AlignedSections = (Section | null)[]

const mergeWindows = (windows: Window[], joinGap: number): Window[] => {
  if (windows.length === 0) return []
  const sorted = [...windows].sort((a, b) => a.from - b.from)
  const out: Window[] = [{ ...sorted[0]! }]

  for (const w of sorted.slice(1)) {
    const last = out[out.length - 1]!
    if (w.from <= last.to + joinGap) last.to = Math.max(last.to, w.to)
    else out.push({ ...w })
  }
  return out
}

/** A stretch with no discernible rhythm: a list, or a grid once it gets long. */
export const classifyIrregular = (times: Minutes[], rules: SegmentRules): Section => ({
  kind: times.length >= rules.hourlyThreshold ? 'hourly' : 'times',
  from: times[0]!,
  to: times[times.length - 1]!,
  times,
})

const headwaysOf = (times: Minutes[]): number[] => {
  const out: number[] = []
  for (let i = 0; i < times.length - 1; i++) out.push(times[i + 1]! - times[i]!)
  return out
}

/**
 * Fill one consensus window for one kind of day.
 *
 * The window came from the group, so this column may not itself be regular
 * across it. Where it is not, the cell falls back to a grid or a list: the row
 * still lines up, it just says something different in that column.
 */
const fillWindow = (times: Minutes[], window: Window, rules: SegmentRules): Section => {
  if (times.length < rules.minTripsForInterval) return classifyIrregular(times, rules)

  const gaps = headwaysOf(times)
  if (gaps.length === 0) return classifyIrregular(times, rules)

  const min = Math.min(...gaps)
  const max = Math.max(...gaps)
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length
  const allowed = Math.max(rules.headwayTolerance, avg * rules.headwayToleranceRatio)

  // Generous: the consensus already found a rhythm here, so this only catches
  // a column that genuinely does not share it. The ratio test is the one that
  // matters — "every 5-25 minutes" tells a passenger nothing, however tidy the
  // arithmetic behind it.
  if (max > min * rules.maxHeadwayRatio || max - min > allowed * 2 || avg > rules.maxHeadwayForInterval) {
    return classifyIrregular(times, rules)
  }

  return { kind: 'interval', from: window.from, to: window.to, min, max, times }
}

const between = (times: Minutes[], from: number, to: number): Minutes[] =>
  times.filter((t) => t >= from && t < to)

interface Slot {
  kind: 'gap' | 'window'
  from: number
  to: number
  window?: Window
}

/** Split `count` departures off one end of a headway, leaving the rest behind. */
const splitOff = (
  section: Section,
  edge: 'first' | 'last',
  count: number,
): { anchor: Section; remainder: Section } | null => {
  if (section.kind !== 'interval' || section.times.length < 2) return null
  const take = Math.min(count, section.times.length - 1)
  if (take < 1) return null

  const taken = edge === 'first' ? section.times.slice(0, take) : section.times.slice(-take)
  const rest = edge === 'first' ? section.times.slice(take) : section.times.slice(0, -take)

  return {
    anchor: {
      kind: 'times',
      from: taken[0]!,
      to: taken[taken.length - 1]!,
      times: taken,
      peeled: edge,
    },
    remainder: {
      ...section,
      times: rest,
      ...(edge === 'first' ? { from: rest[0] ?? section.from } : { to: rest[rest.length - 1] ?? section.to }),
    },
  }
}

/**
 * Give every headway a departure to be counted from, and one to be counted to.
 *
 * "Every 30 minutes" says nothing on its own — from when, until when? So a
 * column showing a headway also shows the service's first and last departures.
 * Where the day already lists departures either side of it, those serve; where
 * it does not, they are split off the headway itself.
 *
 * Anchoring is decided per column but written into rows shared by all of them,
 * so a block stays aligned even when only one kind of day needed one. Tying
 * this to the headway rather than to the first and last slots matters: a day
 * whose closing departure falls past the snapped end of its window already has
 * a slot there, while a day ending exactly on the boundary does not.
 */
const anchorIntervals = (columns: AlignedSections[], rules: SegmentRules): AlignedSections[] => {
  if (columns.length === 0 || columns[0]!.length === 0) return columns
  let work = columns.map((c) => [...c])

  const intervalAt = (index: number) => work.some((c) => c[index]?.kind === 'interval')
  const width = work[0]!.length

  const first = [...Array(width).keys()].find(intervalAt)
  if (first === undefined) return work
  const last = [...Array(width).keys()].reverse().find(intervalAt)!

  const anchor = (edge: 'first' | 'last', intervalIndex: number, slotIndex: number) => {
    work.forEach((sections, col) => {
      const section = sections[intervalIndex]
      if (section?.kind !== 'interval') return
      // Already anchored on this side by departures the day itself lists.
      if (sections[slotIndex]) return

      const wanted = Math.max(1, edge === 'first' ? rules.firstTripsCount : rules.lastTripsCount)
      const split = splitOff(section, edge, wanted)
      if (!split) return

      sections[intervalIndex] = split.remainder
      sections[slotIndex] = split.anchor
      work[col] = sections
    })
  }

  // A headway in the very first slot has nowhere to put its opening
  // departures, so a row is made for them; the same at the other end.
  if (first === 0) {
    work = work.map((c) => [null, ...c])
    anchor('first', 1, 0)
  } else {
    anchor('first', first, first - 1)
  }

  const lastNow = last + (first === 0 ? 1 : 0)
  if (lastNow === work[0]!.length - 1) work = work.map((c) => [...c, null])
  anchor('last', lastNow, lastNow + 1)

  // Drop any row nobody ended up using.
  const used = work[0]!.map((_, i) => work.some((c) => c[i] !== null))
  return work.map((c) => c.filter((_, i) => used[i]))
}

/**
 * Settle the day's shape across all kinds of day, then fill each one against it.
 *
 * Returns one list per input list, all the same length, so the caller can pair
 * them row for row without guessing.
 */
export const segmentDayTypes = (timesByDayType: Minutes[][], rules: SegmentRules): AlignedSections[] => {
  const cleaned = timesByDayType.map(cleanTimes)
  if (cleaned.every((t) => t.length === 0)) return cleaned.map(() => [])

  // Each kind of day proposes where its regular service sits.
  const spans: Window[] = cleaned
    .flatMap((times) => segmentDayCore(times, rules))
    .filter((s) => s.kind === 'interval')
    .map((s) => ({ from: s.from, to: s.to }))

  const windows = mergeWindows(spans, rules.headwayTolerance * 2).filter(
    (w) => w.to - w.from >= rules.minSpanForInterval,
  )

  // Nothing regular anywhere: one section each, so the columns still pair up.
  // The choice between a flat list and an hour-by-hour grid is made once for
  // all of them, or a busy weekday would print a grid beside a Saturday list.
  if (windows.length === 0) {
    const grid = cleaned.some((times) => times.length >= rules.hourlyThreshold)
    return cleaned.map((times) =>
      times.length === 0
        ? []
        : [{ kind: grid ? 'hourly' : 'times', from: times[0]!, to: times[times.length - 1]!, times }],
    )
  }

  if (rules.snapBoundariesToHour) {
    for (const w of windows) {
      const from = floorHour(w.from)
      const to = floorHour(w.to)
      if (to > from) {
        w.from = from
        w.to = to
      }
    }
  }

  const slots: Slot[] = []
  let cursor = -Infinity
  for (const w of windows) {
    slots.push({ kind: 'gap', from: cursor, to: w.from })
    slots.push({ kind: 'window', from: w.from, to: w.to + 1, window: w })
    cursor = w.to + 1
  }
  slots.push({ kind: 'gap', from: cursor, to: Infinity })

  const perSlot = slots.map((slot) => cleaned.map((times) => between(times, slot.from, slot.to)))

  const filled = cleaned.map((_, col) =>
    slots.map((slot, index): Section | null => {
      const inSlot = perSlot[index]![col]!
      if (inSlot.length === 0) return null
      if (slot.kind === 'window') return fillWindow(inSlot, slot.window!, rules)

      // Whether an irregular stretch is listed flat or set out hour by hour is
      // decided for the row, not for each column. Weekdays crossing the
      // threshold while Saturday falls just under it would otherwise print a
      // grid beside a list, in one block, for the same stretch of the day.
      const grid = perSlot[index]!.some((t) => t.length >= rules.hourlyThreshold)
      return {
        kind: grid ? 'hourly' : 'times',
        from: inSlot[0]!,
        to: inSlot[inSlot.length - 1]!,
        times: inSlot,
      }
    }),
  )

  // A window that no column could actually fill leaves irregular slots on both
  // sides of nothing. Merge neighbouring slots where not one column shows a
  // headway, so the day does not fragment into a stack of identical rows.
  const hasInterval = (slotIndex: number) => filled.some((col) => col[slotIndex]?.kind === 'interval')

  const runs: number[][] = []
  for (let i = 0; i < slots.length; i++) {
    const previous = runs[runs.length - 1]
    if (!hasInterval(i) && previous && !hasInterval(previous[0]!)) previous.push(i)
    else runs.push([i])
  }

  const merged: AlignedSections[] = filled.map((col) =>
    runs.map((run) => {
      if (run.length === 1) return col[run[0]!] ?? null
      const times = run.flatMap((i) => col[i]?.times ?? [])
      return times.length === 0 ? null : classifyIrregular(times, rules)
    }),
  )

  // Drop slots nobody used, keeping every column the same length.
  const used = runs.map((_, i) => merged.some((sections) => sections[i] !== null))
  let columns = merged.map((sections) => sections.filter((_, i) => used[i]))
  if (columns[0]?.length === 0) return columns

  return anchorIntervals(columns, rules)
}
