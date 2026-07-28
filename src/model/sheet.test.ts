import { describe, expect, it } from 'vitest'
import { buildSheetBlocks } from './sheet'
import { createDefaultTemplate } from './defaults'
import { parseDelimited } from '../import/csv'
import { guessMapping, importTable } from '../import/table'
import { routeLabel, routesAtStop } from './types'

const from = (csv: string) => {
  const table = parseDelimited(csv)
  return importTable(table, guessMapping(table.header, table.rows)).timetable
}

const blocks = (csv: string, stopId?: string) => {
  const timetable = from(csv)
  const tpl = createDefaultTemplate()
  const id = stopId ?? timetable.stops[0]!.id
  return { timetable, tpl, sheet: buildSheetBlocks(timetable, id, tpl) }
}

describe('identical kinds of day', () => {
  // Same service seven days a week, written out three times.
  const identical = [
    'Route,Stop,Day type,Times',
    '9,Rosia Terminus,Weekdays,07:00 07:30 08:00 08:30 09:00 09:30 10:00 10:30 11:00 11:30 12:00',
    '9,Rosia Terminus,Saturday,07:00 07:30 08:00 08:30 09:00 09:30 10:00 10:30 11:00 11:30 12:00',
    '9,Rosia Terminus,Sunday,07:00 07:30 08:00 08:30 09:00 09:30 10:00 10:30 11:00 11:30 12:00',
  ].join('\n')

  it('collapses to a single column', () => {
    const { sheet } = blocks(identical)
    expect(sheet[0]!.dayTypes).toHaveLength(1)
  })

  it('drops the heading with it, since there is nothing to tell apart', () => {
    const { sheet } = blocks(identical)
    expect(sheet[0]!.dayTypes[0]!.label).toBe('')
  })

  it('keeps the columns when the days actually differ', () => {
    const differing = [
      'Route,Stop,Day type,Times',
      '9,Rosia,Weekdays,07:00 07:30 08:00 08:30 09:00 09:30 10:00 10:30 11:00',
      '9,Rosia,Sunday,09:00 10:00 11:00 12:00 13:00 14:00',
    ].join('\n')
    const { sheet } = blocks(differing)
    expect(sheet[0]!.dayTypes.map((d) => d.label)).toEqual(['Weekdays', 'Sunday'])
  })
})

describe('a headway is always anchored', () => {
  // Every 30 minutes, all day, and nothing else — the case where a sheet could
  // otherwise say "every 30 minutes" without saying from when.
  const everyThirty = (): string => {
    const times: string[] = []
    for (let t = 7 * 60; t <= 21 * 60; t += 30) {
      times.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`)
    }
    return `Route,Stop,Day type,Times\n9,Rosia Terminus,Daily,${times.join(' ')}`
  }

  it('shows a first and a last departure either side of it', () => {
    const { sheet } = blocks(everyThirty())
    const kinds = sheet[0]!.rows.map((r) => r.cells[0]?.kind)
    expect(kinds).toEqual(['times', 'interval', 'times'])
  })

  it('names those rows for what they are', () => {
    const { sheet } = blocks(everyThirty())
    const labels = sheet[0]!.rows.map((r) => r.label)
    expect(labels[0]).toBe('First departures')
    expect(labels[2]).toBe('Last departures')
    expect(labels[1]).toMatch(/every/)
  })

  it('anchors it even when the setting asks for none', () => {
    const timetable = from(everyThirty())
    const tpl = createDefaultTemplate()
    tpl.rules.firstTripsCount = 0
    tpl.rules.lastTripsCount = 0

    const sheet = buildSheetBlocks(timetable, timetable.stops[0]!.id, tpl)
    const kinds = sheet[0]!.rows.map((r) => r.cells[0]?.kind)
    expect(kinds[0]).toBe('times')
    expect(kinds.at(-1)).toBe('times')
  })

  it('the anchors are the day\'s real first and last departures', () => {
    const { sheet } = blocks(everyThirty())
    const first = sheet[0]!.rows[0]!.cells[0]!
    const last = sheet[0]!.rows.at(-1)!.cells[0]!
    expect(first.times[0]).toBe(7 * 60)
    expect(last.times.at(-1)).toBe(21 * 60)
  })
})

describe('one shelter, two directions', () => {
  const bothWays = [
    'Route,Direction,Stop,Stop code,Day type,Times',
    '1,Towards Rosia,Market Place,101,Daily,07:00 07:30 08:00',
    '1,Towards Willis,Market Place,101,Daily,07:12 07:42 08:12',
    '1,Towards Rosia,Queensway,102,Daily,07:03 07:33 08:03',
  ].join('\n')

  it('splits the shelter into a stop per direction', () => {
    const timetable = from(bothWays)
    const market = timetable.stops.filter((s) => s.name === 'Market Place')
    expect(market).toHaveLength(2)
    expect(market.map((s) => s.direction).sort()).toEqual(['Towards Rosia', 'Towards Willis'])
  })

  it('gives both sides the same place, so they can be grouped', () => {
    const timetable = from(bothWays)
    const market = timetable.stops.filter((s) => s.name === 'Market Place')
    expect(new Set(market.map((s) => s.placeId)).size).toBe(1)
  })

  it('keeps their departures apart', () => {
    const timetable = from(bothWays)
    const [rosia, willis] = timetable.stops.filter((s) => s.name === 'Market Place')
    const tpl = createDefaultTemplate()

    const toRosia = buildSheetBlocks(timetable, rosia!.id, tpl)[0]!.rows[0]!.cells[0]!.times
    const toWillis = buildSheetBlocks(timetable, willis!.id, tpl)[0]!.rows[0]!.cells[0]!.times
    expect(toRosia).not.toEqual(toWillis)
    expect(toRosia[0]).toBe(7 * 60)
    expect(toWillis[0]).toBe(7 * 60 + 12)
  })

  it('a stop served one way only is not split', () => {
    const timetable = from(bothWays)
    const queensway = timetable.stops.filter((s) => s.name === 'Queensway')
    expect(queensway).toHaveLength(1)
  })

  it('still lists the route at each side', () => {
    const timetable = from(bothWays)
    for (const stop of timetable.stops) {
      expect(routesAtStop(timetable, stop.id)).toHaveLength(1)
    }
  })
})

describe('routeLabel', () => {
  it('prints the raw number when nothing overrides it', () => {
    expect(routeLabel({ id: 'r1', number: '8', mode: '', terminal: '', via: [], notes: [] })).toBe('8')
  })

  it('prints the override instead, once it is set', () => {
    expect(
      routeLabel({ id: 'r1', number: '8', mode: '', terminal: '', via: [], notes: [], displayLabel: 'N8' }),
    ).toBe('N8')
  })

  it('falls back to the number when the override is blank', () => {
    expect(
      routeLabel({ id: 'r1', number: '8', mode: '', terminal: '', via: [], notes: [], displayLabel: '   ' }),
    ).toBe('8')
  })
})
