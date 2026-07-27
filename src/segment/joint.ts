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

/**
 * Peel the day's opening and closing departures off a leading or trailing
 * headway, for every column at once.
 *
 * Done jointly: if any column can spare departures, the row is added to all of
 * them, so a column with a thin early service leaves a blank rather than
 * pushing everything below it out of step.
 */
const peelJoint = (
  columns: AlignedSections[],
  edge: 'first' | 'last',
  count: number,
  rules: SegmentRules,
): AlignedSections[] => {
  if (count <= 0) return columns
  const index = edge === 'first' ? 0 : columns[0]!.length - 1

  const takes = columns.map((sections) => {
    const section = sections[index]
    if (!section || section.kind !== 'interval') return 0
    return Math.min(count, Math.max(0, section.times.length - rules.minTripsForInterval))
  })

  if (takes.every((t) => t === 0)) return columns

  return columns.map((sections, col) => {
    const take = takes[col]!
    const section = sections[index]
    let peeled: Section | null = null

    if (take > 0 && section && section.kind === 'interval') {
      const taken =
        edge === 'first' ? section.times.slice(0, take) : section.times.slice(section.times.length - take)
      const rest =
        edge === 'first' ? section.times.slice(take) : section.times.slice(0, section.times.length - take)

      sections = [...sections]
      sections[index] = {
        ...section,
        times: rest,
        ...(edge === 'first' ? { from: rest[0] ?? section.from } : { to: rest[rest.length - 1] ?? section.to }),
      }
      peeled = { kind: 'times', from: taken[0]!, to: taken[taken.length - 1]!, times: taken }
    }

    return edge === 'first' ? [peeled, ...sections] : [...sections, peeled]
  })
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
  if (windows.length === 0) {
    return cleaned.map((times) => (times.length === 0 ? [] : [classifyIrregular(times, rules)]))
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

  const filled = cleaned.map((times) =>
    slots.map((slot): Section | null => {
      const inSlot = between(times, slot.from, slot.to)
      if (inSlot.length === 0) return null
      return slot.kind === 'window'
        ? fillWindow(inSlot, slot.window!, rules)
        : classifyIrregular(inSlot, rules)
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

  const keptSlots = runs
    .filter((_, i) => used[i])
    .map((run) => (run.length === 1 ? slots[run[0]!]! : { kind: 'gap' as const, from: 0, to: 0 }))
  if (keptSlots[0]?.kind === 'window') columns = peelJoint(columns, 'first', rules.firstTripsCount, rules)
  if (keptSlots[keptSlots.length - 1]?.kind === 'window') {
    columns = peelJoint(columns, 'last', rules.lastTripsCount, rules)
  }

  return columns
}
