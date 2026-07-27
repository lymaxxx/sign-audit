import { describe, expect, it } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import ExcelJS from 'exceljs'
import { guessMapping, importTable } from './table'
import { parseDelimited, parsePastedList } from './csv'
import { parseWorkbook } from './xlsx'
import { importGtfs } from './gtfs'
import { getDepartures, routesAtStop } from '../model/types'

describe('column guessing', () => {
  it('recognises English headings', () => {
    const m = guessMapping(['Route', 'Stop', 'Day type', 'Departure times'])
    expect(m).toMatchObject({ route: 0, stop: 1, dayType: 2, times: 3 })
  })

  it('recognises Russian headings', () => {
    const m = guessMapping(['Маршрут', 'Остановка', 'Тип дня', 'Времена'])
    expect(m).toMatchObject({ route: 0, stop: 1, dayType: 2, times: 3 })
  })

  it('does not let "stop" swallow "stop_code"', () => {
    const m = guessMapping(['route', 'stop_code', 'stop_name', 'times'])
    expect(m.stopCode).toBe(1)
    expect(m.stop).toBe(2)
  })

  it('spots a sheet laid out one trip per row', () => {
    const m = guessMapping(
      ['Route', 'Day type', 'Aurora Cinema', 'Estonia Street'],
      [['8', 'Weekdays', '06:11', '06:14']],
    )
    expect(m.timeColumnsFrom).toBe(2)
  })
})

describe('CSV import', () => {
  const csv = [
    'Route,Stop,Day type,Times',
    '8,Aurora Cinema,Weekdays,06:11 06:23 06:35',
    '8,Aurora Cinema,Weekends,06:04 06:20',
    '8,Estonia Street,Weekdays,06:14 06:26 06:38',
    '27,Aurora Cinema,Daily,07:10 08:40',
  ].join('\n')

  it('reads routes, stops, day types and departures', () => {
    const table = parseDelimited(csv)
    const { timetable, issues } = importTable(table, guessMapping(table.header, table.rows))

    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0)
    expect(timetable.routes.map((r) => r.number).sort()).toEqual(['27', '8'])
    expect(timetable.stops.map((s) => s.name).sort()).toEqual(['Aurora Cinema', 'Estonia Street'])
    expect(timetable.dayTypes.map((d) => d.label).sort()).toEqual(['Daily', 'Weekdays', 'Weekends'])
  })

  it('keeps each stop on a route separate', () => {
    const table = parseDelimited(csv)
    const { timetable } = importTable(table, guessMapping(table.header, table.rows))
    const route = timetable.routes.find((r) => r.number === '8')!
    const aurora = timetable.stops.find((s) => s.name === 'Aurora Cinema')!
    const estonia = timetable.stops.find((s) => s.name === 'Estonia Street')!

    expect(getDepartures(timetable, route.id, aurora.id, 'weekdays')).toEqual([371, 383, 395])
    expect(getDepartures(timetable, route.id, estonia.id, 'weekdays')).toEqual([374, 386, 398])
  })

  it('sniffs a semicolon delimiter', () => {
    const table = parseDelimited('Route;Stop;Times\n8;Aurora;06:11 06:23')
    expect(table.header).toEqual(['Route', 'Stop', 'Times'])
    expect(table.rows[0]).toEqual(['8', 'Aurora', '06:11 06:23'])
  })

  it('sniffs tabs, which is what a spreadsheet paste gives', () => {
    const table = parseDelimited('Route\tStop\tTimes\n8\tAurora\t06:11')
    expect(table.rows[0]).toEqual(['8', 'Aurora', '06:11'])
  })

  it('reports a row it could not use instead of failing the import', () => {
    const table = parseDelimited('Route,Stop,Times\n8,Aurora,06:11\n,Nowhere,07:00')
    const { timetable, issues } = importTable(table, guessMapping(table.header, table.rows))
    expect(timetable.routes).toHaveLength(1)
    expect(issues.some((i) => i.severity === 'warning' && /route/i.test(i.message))).toBe(true)
  })

  it('lifts departures after midnight onto the service day', () => {
    const table = parseDelimited('Route,Stop,Times\n8,Aurora,22:40 23:20 00:05 00:50')
    const { timetable } = importTable(table, guessMapping(table.header, table.rows))
    const route = timetable.routes[0]!
    const stop = timetable.stops[0]!
    // 00:05 is the last trip of the night, not the first of the morning.
    expect(getDepartures(timetable, route.id, stop.id, 'daily')).toEqual([1360, 1400, 1445, 1490])
  })
})

describe('trip-per-row sheets', () => {
  it('spreads one trip across a column per stop', () => {
    const table = parseDelimited(
      ['Route,Day type,Aurora Cinema,Estonia Street,Lisa Chaikina', '8,Weekdays,06:11,06:14,06:17', '8,Weekdays,06:23,06:26,06:29'].join('\n'),
    )
    const { timetable } = importTable(table, guessMapping(table.header, table.rows))
    const route = timetable.routes[0]!

    expect(timetable.stops.map((s) => s.name)).toEqual(['Aurora Cinema', 'Estonia Street', 'Lisa Chaikina'])
    const aurora = timetable.stops[0]!
    const chaikina = timetable.stops[2]!
    expect(getDepartures(timetable, route.id, aurora.id, 'weekdays')).toEqual([371, 383])
    expect(getDepartures(timetable, route.id, chaikina.id, 'weekdays')).toEqual([377, 389])
  })
})

describe('pasted lists', () => {
  it('takes a route, a kind of day and a run of times', () => {
    const table = parsePastedList('8\tWeekdays\t06:11 06:23 06:35\n27\tDaily\t07:10 08:40')
    const { timetable } = importTable(table, guessMapping(table.header, table.rows), { stop: 'Aurora Cinema' })

    expect(timetable.stops.map((s) => s.name)).toEqual(['Aurora Cinema'])
    expect(timetable.routes.map((r) => r.number)).toEqual(['8', '27'])
    expect(routesAtStop(timetable, timetable.stops[0]!.id)).toHaveLength(2)
  })

  it('assumes daily when only a route and times are given', () => {
    const table = parsePastedList('8  06:11 06:23')
    const { timetable } = importTable(table, guessMapping(table.header, table.rows), { stop: 'Aurora' })
    expect(timetable.dayTypes.map((d) => d.label)).toEqual(['Daily'])
    expect(getDepartures(timetable, timetable.routes[0]!.id, timetable.stops[0]!.id, 'daily')).toEqual([371, 383])
  })
})

describe('Excel import', () => {
  const buildWorkbook = async (): Promise<Uint8Array> => {
    const wb = new ExcelJS.Workbook()
    const sheet = wb.addWorksheet('Timetable')
    sheet.addRow(['Route', 'Stop', 'Day type', 'Times'])
    sheet.addRow(['8', 'Aurora Cinema', 'Weekdays', '06:11 06:23'])

    // A cell Excel stored as a time: a fraction of a day, not a string.
    const row = sheet.addRow(['27', 'Aurora Cinema', 'Daily', null])
    const cell = row.getCell(4)
    cell.value = 7 / 24 + 10 / 1440
    cell.numFmt = 'hh:mm'

    return new Uint8Array(await wb.xlsx.writeBuffer())
  }

  it('reads a worksheet', async () => {
    const tables = await parseWorkbook(await buildWorkbook())
    expect(tables).toHaveLength(1)
    expect(tables[0]!.name).toBe('Timetable')
    expect(tables[0]!.header).toEqual(['Route', 'Stop', 'Day type', 'Times'])
  })

  it('turns a fraction-of-a-day cell back into a clock time', async () => {
    const tables = await parseWorkbook(await buildWorkbook())
    const table = tables[0]!
    expect(table.rows[1]![3]).toBe('07:10')
  })

  it('leaves plain numbers alone, so route 8 does not become 08:00', async () => {
    const tables = await parseWorkbook(await buildWorkbook())
    const { timetable } = importTable(tables[0]!, guessMapping(tables[0]!.header, tables[0]!.rows))
    expect(timetable.routes.map((r) => r.number).sort()).toEqual(['27', '8'])
  })
})

describe('GTFS import', () => {
  const feed = (over: Record<string, string> = {}): Uint8Array => {
    const files: Record<string, string> = {
      'stops.txt': ['stop_id,stop_name,stop_code', 'S1,Aurora Cinema,1041', 'S2,Estonia Street,1042'].join('\n'),
      'routes.txt': ['route_id,route_short_name,route_long_name,route_type,route_color', 'R8,8,Forge Works,11,7B2FF7'].join('\n'),
      'trips.txt': ['trip_id,route_id,service_id,trip_headsign', 'T1,R8,WD,Forge Works', 'T2,R8,WD,Forge Works'].join('\n'),
      'stop_times.txt': [
        'trip_id,stop_id,arrival_time,departure_time,stop_sequence',
        'T1,S1,06:11:00,06:11:00,1',
        'T1,S2,06:14:00,06:14:00,2',
        'T2,S1,25:14:00,25:14:00,1',
      ].join('\n'),
      'calendar.txt': [
        'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date',
        'WD,1,1,1,1,1,0,0,20260101,20261231',
      ].join('\n'),
      ...over,
    }
    return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])))
  }

  it('reads routes, stops and departures', () => {
    const { timetable, issues } = importGtfs(feed())
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0)
    expect(timetable.routes[0]).toMatchObject({ number: '8', mode: 'trolleybus', color: '#7B2FF7' })
    expect(timetable.stops.map((s) => s.name).sort()).toEqual(['Aurora Cinema', 'Estonia Street'])
  })

  it('names the kind of day from the calendar', () => {
    const { timetable } = importGtfs(feed())
    expect(timetable.dayTypes.map((d) => d.label)).toEqual(['Weekdays'])
  })

  it('keeps service after midnight past 24:00, as the feed states it', () => {
    const { timetable } = importGtfs(feed())
    const times = getDepartures(timetable, 'R8', 'S1', 'weekdays')
    // 25:14 is 1514 minutes: the last trip of the night.
    expect(times).toEqual([371, 1514])
  })

  it('drops stops the feed never serves', () => {
    const { timetable } = importGtfs(
      feed({ 'stops.txt': ['stop_id,stop_name', 'S1,Aurora Cinema', 'S2,Estonia Street', 'S9,Never Served'].join('\n') }),
    )
    expect(timetable.stops.map((s) => s.id).sort()).toEqual(['S1', 'S2'])
  })

  it('says what is missing rather than throwing', () => {
    const broken = zipSync({ 'stops.txt': strToU8('stop_id,stop_name\nS1,Aurora') })
    const { issues } = importGtfs(broken)
    expect(issues[0]!.severity).toBe('error')
    expect(issues[0]!.message).toMatch(/routes\.txt/)
  })

  it('warns when there is no calendar to read', () => {
    const noCalendar = feed()
    const files = importGtfs(
      zipSync({
        'stops.txt': strToU8('stop_id,stop_name\nS1,Aurora'),
        'routes.txt': strToU8('route_id,route_short_name,route_type\nR8,8,3'),
        'trips.txt': strToU8('trip_id,route_id,service_id\nT1,R8,WD'),
        'stop_times.txt': strToU8('trip_id,stop_id,departure_time,stop_sequence\nT1,S1,06:11:00,1'),
      }),
    )
    void noCalendar
    expect(files.issues.some((i) => /calendar/i.test(i.message))).toBe(true)
    expect(files.timetable.dayTypes.map((d) => d.label)).toEqual(['Daily'])
  })
})
