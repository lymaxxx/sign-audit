import Papa from 'papaparse'
import { unzipSync } from 'fflate'
import { cleanTimes, normaliseServiceDay, parseTime, type Minutes } from '../model/time'
import { departuresKey, type DayType, type Route, type Stop } from '../model/types'
import type { ImportIssue, ImportResult } from './types'

/**
 * GTFS feeds.
 *
 * The format transit agencies already publish, so a city can go from feed to
 * printable sheets without anyone preparing a spreadsheet first. GTFS states
 * post-midnight service as hours past 24 — `25:14:00` — which is the same
 * convention the layout engine uses, so those times pass straight through.
 */

const ROUTE_TYPES: Record<string, string> = {
  '0': 'tram',
  '1': 'metro',
  '2': 'rail',
  '3': 'bus',
  '4': 'ferry',
  '5': 'cable tram',
  '6': 'cable car',
  '7': 'funicular',
  '11': 'trolleybus',
  '12': 'monorail',
}

type Row = Record<string, string>

const readCsv = (text: string): Row[] => {
  const parsed = Papa.parse<Row>(text.trim(), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim().replace(/^﻿/, ''),
  })
  return parsed.data ?? []
}

/** GTFS times run past 24:00 for service after midnight; keep that. */
const parseGtfsTime = (raw: string): Minutes | null => {
  const m = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(raw.trim())
  if (!m) return parseTime(raw)
  const minutes = Number(m[2])
  if (minutes > 59) return null
  return Number(m[1]) * 60 + minutes
}

const decode = (bytes: Uint8Array): string => new TextDecoder('utf-8').decode(bytes)

/** Which days a service runs on, as a label a sheet can print. */
const calendarLabel = (row: Row): string => {
  const days: Array<[string, string]> = [
    ['monday', 'Mon'],
    ['tuesday', 'Tue'],
    ['wednesday', 'Wed'],
    ['thursday', 'Thu'],
    ['friday', 'Fri'],
    ['saturday', 'Sat'],
    ['sunday', 'Sun'],
  ]
  const active = days.filter(([key]) => row[key] === '1').map(([, label]) => label)

  if (active.length === 7) return 'Daily'
  if (active.length === 5 && !active.includes('Sat') && !active.includes('Sun')) return 'Weekdays'
  if (active.length === 2 && active.includes('Sat') && active.includes('Sun')) return 'Weekends'
  if (active.length === 0) return 'Daily'
  return active.join(', ')
}

export const importGtfs = (zip: Uint8Array): ImportResult => {
  const issues: ImportIssue[] = []
  const files = unzipSync(zip)

  // Feeds are sometimes zipped with the txt files inside a folder.
  const find = (name: string): Uint8Array | undefined => {
    const exact = files[name]
    if (exact) return exact
    const key = Object.keys(files).find((k) => k.endsWith(`/${name}`) || k === name)
    return key ? files[key] : undefined
  }

  const required = ['stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt']
  const missing = required.filter((f) => !find(f))
  if (missing.length > 0) {
    return {
      timetable: { routes: [], stops: [], dayTypes: [], departures: new Map() },
      issues: [{ severity: 'error', message: `Feed is missing ${missing.join(', ')}.`, where: 'GTFS' }],
    }
  }

  const stopRows = readCsv(decode(find('stops.txt')!))
  const routeRows = readCsv(decode(find('routes.txt')!))
  const tripRows = readCsv(decode(find('trips.txt')!))
  const stopTimeRows = readCsv(decode(find('stop_times.txt')!))
  const calendarFile = find('calendar.txt')
  const calendarRows = calendarFile ? readCsv(decode(calendarFile)) : []

  const stops = new Map<string, Stop>()
  for (const row of stopRows) {
    const id = row.stop_id?.trim()
    if (!id) continue
    // Platforms belong to their parent station's sheet, not their own.
    if (row.location_type && row.location_type !== '0') continue
    stops.set(id, {
      id,
      name: row.stop_name?.trim() || id,
      ...(row.stop_code?.trim() ? { code: row.stop_code.trim() } : {}),
    })
  }

  const routes = new Map<string, Route>()
  for (const row of routeRows) {
    const id = row.route_id?.trim()
    if (!id) continue
    const color = row.route_color?.trim()
    routes.set(id, {
      id,
      number: row.route_short_name?.trim() || row.route_long_name?.trim() || id,
      mode: ROUTE_TYPES[row.route_type?.trim() ?? ''] ?? 'bus',
      terminal: row.route_long_name?.trim() || '',
      via: [],
      notes: [],
      ...(color ? { color: color.startsWith('#') ? color : `#${color}` } : {}),
    })
  }

  const serviceLabels = new Map<string, string>()
  for (const row of calendarRows) {
    const id = row.service_id?.trim()
    if (id) serviceLabels.set(id, calendarLabel(row))
  }

  interface TripInfo {
    routeId: string
    dayTypeLabel: string
    headsign: string
    /** What a passenger at this kerb would call the way the bus is facing. */
    direction: string
  }
  const trips = new Map<string, TripInfo>()
  for (const row of tripRows) {
    const id = row.trip_id?.trim()
    const routeId = row.route_id?.trim()
    if (!id || !routeId) continue

    const headsign = row.trip_headsign?.trim() ?? ''
    const directionId = row.direction_id?.trim() ?? ''
    // The headsign names the direction far better than "0" and "1" do; the id
    // is only the fallback, and only when the feed distinguishes the two.
    const direction = headsign || (directionId ? `Direction ${directionId}` : '')

    trips.set(id, {
      routeId,
      dayTypeLabel: serviceLabels.get(row.service_id?.trim() ?? '') ?? 'Daily',
      headsign,
      direction,
    })
  }

  // Only split a shelter when the feed actually serves it both ways; otherwise
  // every stop would gain a direction suffix it does not need.
  const directionsPerStop = new Map<string, Set<string>>()
  for (const row of stopTimeRows) {
    const trip = trips.get(row.trip_id?.trim() ?? '')
    const stopId = row.stop_id?.trim()
    if (!trip || !stopId || !trip.direction) continue
    const seen = directionsPerStop.get(stopId) ?? new Set<string>()
    seen.add(trip.direction)
    directionsPerStop.set(stopId, seen)
  }

  const dayTypes = new Map<string, DayType>()
  const dayTypeIdFor = (label: string): string => {
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'daily'
    if (!dayTypes.has(id)) dayTypes.set(id, { id, label })
    return id
  }

  const departures = new Map<string, Minutes[]>()
  // Noted as we go. A citywide feed lists every stop in the region, and a
  // sheet should only offer the ones this import actually serves.
  const usedStops = new Set<string>()
  const usedRoutes = new Set<string>()
  let skipped = 0

  // One entry per side of a shelter, created as the times are read.
  const sides = new Map<string, Stop>()

  for (const row of stopTimeRows) {
    const trip = trips.get(row.trip_id?.trim() ?? '')
    if (!trip) continue
    const place = stops.get(row.stop_id?.trim() ?? '')
    if (!place) continue

    const raw = row.departure_time?.trim() || row.arrival_time?.trim()
    if (!raw) continue
    const time = parseGtfsTime(raw)
    if (time === null) {
      skipped++
      continue
    }

    const route = routes.get(trip.routeId)
    if (!route) continue
    // A headsign on the trip is more specific than the route's long name.
    if (trip.headsign && !route.terminal) route.terminal = trip.headsign

    const bothWays = (directionsPerStop.get(place.id)?.size ?? 0) > 1
    const direction = bothWays ? trip.direction : ''
    const sideId = direction ? `${place.id}-${direction.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : place.id

    let side = sides.get(sideId)
    if (!side) {
      side = {
        id: sideId,
        name: place.name,
        placeId: place.id,
        ...(place.code ? { code: place.code } : {}),
        ...(direction ? { direction } : {}),
      }
      sides.set(sideId, side)
    }

    usedRoutes.add(route.id)
    usedStops.add(side.id)

    const key = departuresKey(route.id, side.id, dayTypeIdFor(trip.dayTypeLabel))
    const list = departures.get(key)
    if (list) list.push(time)
    else departures.set(key, [time])
  }

  if (skipped > 0) {
    issues.push({ severity: 'warning', message: `${skipped} stop times could not be read.`, where: 'stop_times.txt' })
  }
  if (departures.size === 0) {
    issues.push({ severity: 'error', message: 'No departures were found in the feed.', where: 'GTFS' })
  }
  if (!calendarFile) {
    issues.push({
      severity: 'warning',
      message: 'No calendar.txt, so every trip is treated as running daily.',
      where: 'GTFS',
    })
  }

  for (const [key, times] of departures) {
    departures.set(key, normaliseServiceDay(cleanTimes(times)))
  }

  return {
    timetable: {
      routes: [...routes.values()].filter((r) => usedRoutes.has(r.id)),
      stops: [...sides.values()].filter((s) => usedStops.has(s.id)),
      dayTypes: [...dayTypes.values()],
      departures,
    },
    issues,
  }
}
