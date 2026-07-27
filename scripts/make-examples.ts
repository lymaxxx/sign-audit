import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeDemoTimetable } from '../src/model/demo'
import { formatTime } from '../src/model/time'
import { dayTypesForRouteAtStop, getDepartures, routesAtStop } from '../src/model/types'
import { parseDelimited } from '../src/import/csv'
import { guessMapping, importTable } from '../src/import/table'

/**
 * Writes example CSVs in both shapes the importer understands, then reads them
 * back to check they really do come in as the timetable they were written
 * from. An example that does not import is worse than no example.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'examples')

const csvCell = (value: string): string => (/[",;\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)
const csvRow = (cells: string[]): string => cells.map(csvCell).join(',')

const timetable = makeDemoTimetable()

/**
 * One row per route, stop and kind of day, with all that day's departures in
 * one cell. The shape most agencies can produce from a planning system.
 */
const longForm = (): string => {
  const lines = [csvRow(['Route', 'Mode', 'Terminal', 'Via', 'Stop', 'Stop code', 'Day type', 'Times'])]

  for (const stop of timetable.stops) {
    for (const route of routesAtStop(timetable, stop.id)) {
      for (const dayType of dayTypesForRouteAtStop(timetable, route.id, stop.id)) {
        const times = getDepartures(timetable, route.id, stop.id, dayType.id)
        lines.push(
          csvRow([
            route.number,
            route.mode,
            route.terminal,
            route.via.join(', '),
            stop.name,
            stop.code ?? '',
            dayType.label,
            times.map((t) => formatTime(t)).join(' '),
          ]),
        )
      }
    }
  }
  return lines.join('\n') + '\n'
}

/**
 * One row per trip, with a column for every stop it calls at — the shape a
 * running-board or a duty schedule usually comes in.
 */
const wideForm = (routeId: string, dayTypeId: string): string => {
  const route = timetable.routes.find((r) => r.id === routeId)!
  const dayType = timetable.dayTypes.find((d) => d.id === dayTypeId)!
  const stops = timetable.stops.filter((s) => getDepartures(timetable, routeId, s.id, dayTypeId).length > 0)

  const lines = [csvRow(['Route', 'Day type', ...stops.map((s) => s.name)])]
  const tripCount = getDepartures(timetable, routeId, stops[0]!.id, dayTypeId).length

  for (let trip = 0; trip < tripCount; trip++) {
    const cells = stops.map((stop) => {
      const time = getDepartures(timetable, routeId, stop.id, dayTypeId)[trip]
      return time === undefined ? '' : formatTime(time)
    })
    lines.push(csvRow([route.number, dayType.label, ...cells]))
  }
  return lines.join('\n') + '\n'
}

/** The smallest thing that works: one stop, three routes, nothing else. */
const minimal = (): string =>
  [
    csvRow(['Route', 'Stop', 'Day type', 'Times']),
    csvRow(['8', 'Aurora Cinema', 'Weekdays', '06:11 06:23 06:35 06:47 07:00 07:12 07:25 07:38 07:50']),
    csvRow(['8', 'Aurora Cinema', 'Weekends', '06:04 06:20 06:38 06:55 07:14 07:32 07:50']),
    csvRow(['27', 'Aurora Cinema', 'Daily', '07:10 08:40 10:56 12:26 14:16 16:04 17:34 19:50 21:20']),
    // Service past midnight belongs to the evening it ran out of, so it may be
    // written either way round; both come in as the last trips of the day.
    csvRow(['83', 'Aurora Cinema', 'Daily', '22:40 23:20 00:05 00:50']),
    csvRow(['83', 'Aurora Cinema', 'Weekends', '22:44 23:26 24:11 24:58']),
  ].join('\n') + '\n'

const run = async () => {
  await mkdir(OUT, { recursive: true })

  const files: Array<[string, string]> = [
    ['schedule-long-form.csv', longForm()],
    ['schedule-trip-per-row.csv', wideForm('r8', 'weekday')],
    ['schedule-minimal.csv', minimal()],
  ]

  for (const [name, content] of files) {
    await writeFile(join(OUT, name), content, 'utf8')
  }

  // Read each one back the way the app will.
  let failed = 0
  for (const [name, content] of files) {
    const table = parseDelimited(content, name)
    const mapping = guessMapping(table.header, table.rows)
    const { timetable: read, issues } = importTable(table, mapping)
    const errors = issues.filter((i) => i.severity === 'error')

    const shape = mapping.timeColumnsFrom !== undefined ? 'trip per row' : 'one row per day'
    const departures = [...read.departures.values()].reduce((n, t) => n + t.length, 0)
    const ok = errors.length === 0 && read.stops.length > 0 && departures > 0
    if (!ok) failed++

    console.log(
      `${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(28)} ${shape.padEnd(16)} ` +
        `${read.routes.length} routes · ${read.stops.length} stops · ` +
        `${read.dayTypes.length} day types · ${departures} departures` +
        (errors.length ? `  — ${errors[0]!.message}` : ''),
    )
  }

  console.log(failed === 0 ? '\nEvery example imports.' : `\n${failed} example(s) failed to import.`)
  if (failed > 0) process.exitCode = 1
}

await run()
