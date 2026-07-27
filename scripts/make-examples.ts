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

/**
 * A whole small network: every route, every stop on it, both ways.
 *
 * The shape a planning department actually hands over. One shelter appears
 * twice — once per direction — because the outbound and inbound sheets are
 * different documents: the times differ, and a passenger on one side of the
 * road has no use for the other side's departures.
 */
const network = (): string => {
  const lines = [csvRow(['Route', 'Mode', 'Direction', 'Terminal', 'Stop', 'Stop code', 'Day type', 'Times'])]

  // Direction names the side of the road, not the route's terminal. Both
  // lines call at Market Place, and a passenger waiting there is on one of two
  // kerbs — not on "towards Rosia" for one route and "towards the airport" for
  // another. Naming sides per route would give that shelter three sheets.
  const SIDES: [string, string] = ['Southbound', 'Northbound']

  const corridors: Array<{
    number: string
    mode: string
    ends: [string, string]
    stops: Array<{ name: string; code: string }>
    firstOut: number
    headway: number
    trips: number
  }> = [
    {
      number: '1',
      mode: 'bus',
      ends: ['Rosia Terminus', "Willis's Road Terminus"],
      stops: [
        { name: 'Market Place', code: '101' },
        { name: 'Queensway', code: '102' },
        { name: 'Trafalgar Cemetery', code: '103' },
        { name: 'Rosia Parade', code: '104' },
      ],
      firstOut: 7 * 60,
      headway: 30,
      trips: 28,
    },
    {
      number: '9',
      mode: 'bus',
      ends: ['Rosia Terminus', 'Airport'],
      stops: [
        { name: 'Market Place', code: '101' },
        { name: 'Devil’s Tower Road', code: '201' },
        { name: 'Rosia Parade', code: '104' },
      ],
      firstOut: 7 * 60 + 15,
      headway: 40,
      trips: 20,
    },
  ]

  for (const line of corridors) {
    for (const [way, terminal] of line.ends.entries()) {
      // Inbound runs the corridor backwards, so a stop's position — and with
      // it the minute a vehicle reaches it — differs between the two sheets.
      const order = way === 0 ? line.stops : [...line.stops].reverse()

      order.forEach((stop, index) => {
        for (const dayType of ['Weekdays', 'Saturday', 'Sunday & Public Holidays']) {
          const shift = dayType === 'Weekdays' ? 0 : dayType === 'Saturday' ? 30 : 60
          const count = dayType === 'Weekdays' ? line.trips : Math.round(line.trips * 0.7)

          const times: number[] = []
          for (let trip = 0; trip < count; trip++) {
            times.push(line.firstOut + shift + way * 20 + index * 3 + trip * line.headway)
          }

          lines.push(
            csvRow([
              line.number,
              line.mode,
              SIDES[way]!,
              terminal,
              stop.name,
              stop.code,
              dayType,
              times.map((t) => formatTime(t)).join(' '),
            ]),
          )
        }
      })
    }
  }

  return lines.join('\n') + '\n'
}

/**
 * The same service every day of the week, stated three times.
 *
 * Worth having as an example because of what the sheet does with it: three
 * identical columns say nothing a passenger can act on, so they collapse into
 * one and the day-type headings go with them.
 */
const identicalDays = (): string => {
  const times: string[] = []
  for (let t = 7 * 60; t <= 21 * 60; t += 30) {
    times.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`)
  }
  const run = times.join(' ')

  return (
    [
      csvRow(['Route', 'Stop', 'Day type', 'Times']),
      csvRow(['9', 'Rosia Terminus', 'Weekdays', run]),
      csvRow(['9', 'Rosia Terminus', 'Saturday', run]),
      csvRow(['9', 'Rosia Terminus', 'Sunday & Public Holidays', run]),
    ].join('\n') + '\n'
  )
}

const run = async () => {
  await mkdir(OUT, { recursive: true })

  const files: Array<[string, string]> = [
    ['schedule-network-two-directions.csv', network()],
    ['schedule-identical-days.csv', identicalDays()],
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

    const shape = mapping.timeColumnsFrom !== undefined ? "trip per row" : "one row per day"
    const sides = read.stops.filter((s) => s.direction).length
    const departures = [...read.departures.values()].reduce((n, t) => n + t.length, 0)
    const ok = errors.length === 0 && read.stops.length > 0 && departures > 0
    if (!ok) failed++

    console.log(
      `${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(28)} ${shape.padEnd(16)} ` +
        `${read.routes.length} routes · ${read.stops.length} stops · ` +
        `${read.dayTypes.length} day types · ${departures} departures` +
          (sides ? ` · ${sides} directional sides` : '') +
        (errors.length ? `  — ${errors[0]!.message}` : ''),
    )
  }

  console.log(failed === 0 ? '\nEvery example imports.' : `\n${failed} example(s) failed to import.`)
  if (failed > 0) process.exitCode = 1
}

await run()
