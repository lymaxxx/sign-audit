import type { AlignedSections, Section } from '../segment'
import { formatHour, type Minutes } from '../model/time'
import type { BlockConfig, SegmentRules } from '../model/template'

/**
 * A route block is a grid: sections down the side, kinds of day across the top.
 *
 * The columns arrive already aligned — `segmentDayTypes` settles the day's
 * shape across every kind of day before filling any of them — so rows here are
 * simply positions in that shared shape. What is left to decide is what each
 * row should be called.
 */

export interface BlockRow {
  label: string
  /** One cell per day type, in column order. Null where that kind of day has
   *  nothing at this position. */
  cells: (Section | null)[]
}

const hoursLabel = (template: string, from: Minutes, to: Minutes, rules: SegmentRules): string =>
  template
    .replace('{from}', formatHour(from, { postMidnightAsHour24: rules.postMidnightAsHour24, padHour: false }))
    .replace('{to}', formatHour(to, { postMidnightAsHour24: rules.postMidnightAsHour24, padHour: false }))

/**
 * Name a row after what is actually in it.
 *
 * A departure list sitting either side of a headway is the day's opening or
 * closing service and reads better said that way. A row where one column shows
 * a headway and another does not gets the span alone, without the word
 * "every", which would only be true of one of them.
 */
const labelFor = (
  cells: (Section | null)[],
  index: number,
  total: number,
  neighbours: { prevIsInterval: boolean; nextIsInterval: boolean },
  block: BlockConfig,
  rules: SegmentRules,
): string => {
  const present = cells.filter((c): c is Section => c !== null)
  if (present.length === 0) return ''

  const intervals = present.filter((c) => c.kind === 'interval')
  if (intervals.length > 0) {
    const from = Math.min(...intervals.map((c) => c.from))
    const to = Math.max(...intervals.map((c) => c.to))
    const template = intervals.length === present.length ? block.labels.interval : block.labels.window
    return hoursLabel(template, from, to, rules)
  }

  // Only a stretch actually split off a headway earns "first"/"last"; a full
  // day's grid that merely happens to sit in the top row is not the day's
  // opening service.
  if (present.some((c) => c.peeled === 'first')) return block.labels.firstTrips
  if (present.some((c) => c.peeled === 'last')) return block.labels.lastTrips

  if (present.every((c) => c.kind === 'hourly')) return block.labels.hourly
  if (index === 0 && neighbours.nextIsInterval && present.every((c) => c.kind === 'times')) {
    return block.labels.firstTrips
  }
  if (index === total - 1 && neighbours.prevIsInterval && present.every((c) => c.kind === 'times')) {
    return block.labels.lastTrips
  }
  return block.labels.times
}

const anyInterval = (cells: (Section | null)[] | undefined): boolean =>
  (cells ?? []).some((c) => c?.kind === 'interval')

export const buildRows = (
  columns: AlignedSections[],
  block: BlockConfig,
  rules: SegmentRules,
): BlockRow[] => {
  const rowCount = Math.max(0, ...columns.map((c) => c.length))
  if (rowCount === 0) return []

  const grid: (Section | null)[][] = []
  for (let r = 0; r < rowCount; r++) grid.push(columns.map((c) => c[r] ?? null))

  return grid.map((cells, r) => ({
    label: labelFor(
      cells,
      r,
      rowCount,
      { prevIsInterval: anyInterval(grid[r - 1]), nextIsInterval: anyInterval(grid[r + 1]) },
      block,
      rules,
    ),
    cells,
  }))
}
