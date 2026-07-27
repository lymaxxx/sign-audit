import { cleanTimes, normaliseServiceDay, parseTime, parseTimeList, type Minutes } from '../model/time'
import { departuresKey, type DayType, type Route, type Stop } from '../model/types'
import type { ColumnMapping, ImportIssue, ImportResult, RawTable } from './types'

/**
 * Turning a spreadsheet into a timetable.
 *
 * Agencies hand these over in two shapes: one row per departure, or one row
 * per trip with a column for each stop. Both are handled, and which one it is
 * is guessed from the header before the user gets a chance to correct it.
 */

const HEADER_HINTS: Record<keyof ColumnMapping, string[]> = {
  route: ['route', 'line', 'маршрут', 'линия', 'номер', 'no', 'nr'],
  stop: ['stop', 'station', 'остановка', 'станция', 'платформа'],
  stopCode: ['stop_code', 'stopcode', 'code', 'код'],
  dayType: ['day', 'daytype', 'service', 'calendar', 'день', 'дни', 'тип дня', 'режим'],
  times: ['time', 'times', 'departure', 'departures', 'время', 'времена', 'отправление', 'рейс'],
  terminal: ['terminal', 'destination', 'headsign', 'to', 'конечная', 'направление', 'до'],
  via: ['via', 'streets', 'through', 'через', 'улицы'],
  mode: ['mode', 'type', 'transport', 'вид', 'тип транспорта'],
  color: ['color', 'colour', 'цвет'],
  timeColumnsFrom: [],
}

const normalise = (s: string): string => s.trim().toLowerCase().replace(/[_\-\s]+/g, ' ')

/**
 * Best guess at what each column means.
 *
 * Headings settle the named fields. Whether the sheet is one departure per row
 * or one *trip* per row is decided from the data instead: in the trip-per-row
 * form the headings are stop names, which no heading rule could recognise, but
 * the cells beneath them are unmistakably clock times.
 */
export const guessMapping = (header: string[], rows: string[][] = []): ColumnMapping => {
  const mapping: ColumnMapping = {}
  const taken = new Set<number>()

  // Matched on whole words. A substring test looks harmless until the "to"
  // hint for a destination column fires on "Estonia Street".
  const matches = (heading: string, hint: string): boolean => {
    if (heading === hint) return true
    const words = heading.split(' ')
    if (hint.includes(' ')) return heading.includes(hint)
    return words.includes(hint)
  }

  const claim = (field: keyof ColumnMapping, hints: string[]) => {
    for (let i = 0; i < header.length; i++) {
      if (taken.has(i)) continue
      const h = normalise(header[i] ?? '')
      if (!h) continue
      if (hints.some((hint) => matches(h, hint))) {
        ;(mapping as Record<string, number>)[field] = i
        taken.add(i)
        return
      }
    }
  }

  // Most specific first, so "stop_code" is not eaten by "stop".
  claim('stopCode', HEADER_HINTS.stopCode)
  claim('dayType', HEADER_HINTS.dayType)
  claim('route', HEADER_HINTS.route)
  claim('stop', HEADER_HINTS.stop)
  claim('terminal', HEADER_HINTS.terminal)
  claim('via', HEADER_HINTS.via)
  claim('mode', HEADER_HINTS.mode)
  claim('color', HEADER_HINTS.color)
  claim('times', HEADER_HINTS.times)

  // Trip-per-row form: a run of unclaimed columns whose cells hold single
  // clock times, headed by stop names.
  const sample = rows.slice(0, 20)
  const looksLikeTimeColumn = (col: number): boolean => {
    const values = sample.map((r) => (r[col] ?? '').trim()).filter(Boolean)
    if (values.length === 0) return false
    return values.every((v) => parseTime(v) !== null)
  }

  const candidates: number[] = []
  for (let i = 0; i < header.length; i++) {
    if (taken.has(i)) continue
    if (header[i]?.trim() && looksLikeTimeColumn(i)) candidates.push(i)
  }

  // Two or more, so a single stray column of times is read as one stop's
  // departures rather than reshaping the whole sheet.
  if (candidates.length >= 2) {
    mapping.timeColumnsFrom = candidates[0]!
    delete mapping.times
  }

  return mapping
}

const slug = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '') || 'x'

interface Builder {
  routes: Map<string, Route>
  stops: Map<string, Stop>
  dayTypes: Map<string, DayType>
  departures: Map<string, Minutes[]>
}

const newBuilder = (): Builder => ({
  routes: new Map(),
  stops: new Map(),
  dayTypes: new Map(),
  departures: new Map(),
})

const upsertRoute = (b: Builder, number: string, fields: Partial<Route> = {}): Route => {
  const id = `r-${slug(number)}`
  const existing = b.routes.get(id)
  if (existing) {
    // Later rows may carry detail the first one lacked.
    if (!existing.terminal && fields.terminal) existing.terminal = fields.terminal
    if (existing.via.length === 0 && fields.via?.length) existing.via = fields.via
    if (!existing.color && fields.color) existing.color = fields.color
    if (existing.mode === 'bus' && fields.mode) existing.mode = fields.mode
    return existing
  }
  const route: Route = {
    id,
    number,
    mode: fields.mode ?? 'bus',
    terminal: fields.terminal ?? '',
    via: fields.via ?? [],
    notes: [],
    ...(fields.color ? { color: fields.color } : {}),
  }
  b.routes.set(id, route)
  return route
}

const upsertStop = (b: Builder, name: string, code?: string): Stop => {
  const id = `s-${slug(name)}`
  const existing = b.stops.get(id)
  if (existing) {
    if (!existing.code && code) existing.code = code
    return existing
  }
  const stop: Stop = { id, name, ...(code ? { code } : {}) }
  b.stops.set(id, stop)
  return stop
}

const upsertDayType = (b: Builder, label: string): DayType => {
  const clean = label.trim() || 'Daily'
  const id = slug(clean)
  const existing = b.dayTypes.get(id)
  if (existing) return existing
  const dayType: DayType = { id, label: clean }
  b.dayTypes.set(id, dayType)
  return dayType
}

const addDepartures = (b: Builder, routeId: string, stopId: string, dayTypeId: string, times: Minutes[]) => {
  if (times.length === 0) return
  const key = departuresKey(routeId, stopId, dayTypeId)
  const existing = b.departures.get(key)
  b.departures.set(key, existing ? [...existing, ...times] : [...times])
}

const finish = (b: Builder, issues: ImportIssue[]): ImportResult => {
  const departures = new Map<string, Minutes[]>()
  for (const [key, times] of b.departures) {
    // Lift before sorting. A timetable listing `22:40 23:20 00:05` says the
    // last two run after midnight, and it says so by the order it lists them
    // in — sorting first would throw that evidence away.
    departures.set(key, cleanTimes(normaliseServiceDay(times)))
  }

  return {
    timetable: {
      routes: [...b.routes.values()],
      stops: [...b.stops.values()],
      dayTypes: [...b.dayTypes.values()],
      departures,
    },
    issues,
  }
}

const cell = (row: string[], index: number | undefined): string =>
  index === undefined ? '' : (row[index] ?? '').trim()

/**
 * Read a table into a timetable.
 *
 * With `timeColumnsFrom` set, each row is one trip and the columns from there
 * on are stops; otherwise each row carries its own departures.
 */
export interface ImportDefaults {
  /** Used when the table has no stop column — a paste made against one stop. */
  stop?: string
  dayType?: string
  route?: string
}

export const importTable = (
  table: RawTable,
  mapping: ColumnMapping,
  defaults: ImportDefaults = {},
): ImportResult => {
  const b = newBuilder()
  const issues: ImportIssue[] = []
  const wideForm = mapping.timeColumnsFrom !== undefined

  table.rows.forEach((row, rowIndex) => {
    const where = `${table.name} row ${rowIndex + 2}`
    if (row.every((c) => !c?.trim())) return

    const routeNumber = cell(row, mapping.route) || (defaults.route ?? '')
    if (!routeNumber) {
      issues.push({ severity: 'warning', message: 'No route on this row; skipped.', where })
      return
    }

    const route = upsertRoute(b, routeNumber, {
      terminal: cell(row, mapping.terminal),
      via: cell(row, mapping.via)
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean),
      mode: cell(row, mapping.mode) || undefined,
      color: cell(row, mapping.color) || undefined,
    })

    const dayType = upsertDayType(b, cell(row, mapping.dayType) || defaults.dayType || 'Daily')

    if (wideForm) {
      // One trip per row; every column from here is a stop.
      for (let col = mapping.timeColumnsFrom!; col < table.header.length; col++) {
        const stopName = (table.header[col] ?? '').trim()
        if (!stopName) continue
        const raw = (row[col] ?? '').trim()
        if (!raw) continue

        const time = parseTime(raw)
        if (time === null) {
          issues.push({ severity: 'warning', message: `Could not read the time "${raw}".`, where })
          continue
        }
        const stop = upsertStop(b, stopName)
        addDepartures(b, route.id, stop.id, dayType.id, [time])
      }
      return
    }

    const stopName = cell(row, mapping.stop) || (defaults.stop ?? '')
    if (!stopName) {
      issues.push({ severity: 'warning', message: 'No stop on this row; skipped.', where })
      return
    }
    const stop = upsertStop(b, stopName, cell(row, mapping.stopCode) || undefined)

    const raw = cell(row, mapping.times)
    const times = parseTimeList(raw)
    if (raw && times.length === 0) {
      issues.push({ severity: 'warning', message: `No departures found in "${raw}".`, where })
    }
    addDepartures(b, route.id, stop.id, dayType.id, times)
  })

  if (b.departures.size === 0) {
    issues.push({
      severity: 'error',
      message: 'No departures were found. Check which columns hold the times.',
      where: table.name,
    })
  }

  return finish(b, issues)
}
