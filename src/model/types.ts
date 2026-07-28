import type { Minutes } from './time'

/** A line of service. Colour and mode come from the source data, not the theme. */
export interface Route {
  id: string
  /** Printed designation: `8`, `27`, `T7`. */
  number: string
  /** Free text — `bus`, `tram`, `trolleybus`, or whatever the agency calls it. */
  mode: string
  /** Agency livery colour for this line, if the data carries one. */
  color?: string
  /** Headsign: where a vehicle on this line is going. */
  terminal: string
  /** Streets the line runs along, printed under the headsign. */
  via: string[]
  operator?: string
  accessible?: boolean
  /** Free-form remarks printed beneath the block. */
  notes: string[]
  /** Overrides what prints on the badge and in the title's route list, without
   *  touching `number` — which is still what data and edits key off of. */
  displayLabel?: string
  /** Runs on its own schedule nobody would think to look for beside the day
   *  network, so its block is pulled out of the grid and listed on its own
   *  along the foot of the sheet instead. */
  isNightRoute?: boolean
}

/** What actually prints on a route's badge: a display override where one is
 *  set, the raw number otherwise. */
export const routeLabel = (route: Route): string => route.displayLabel?.trim() || route.number

/**
 * One side of one stop.
 *
 * A shelter serving both directions is two of these, not one. The times differ
 * — outbound and inbound reach the same kerb at different minutes — and a
 * passenger standing at one of them has no use for the other's departures. So
 * direction is part of a stop's identity here, and each side gets its own
 * sheet.
 */
export interface Stop {
  id: string
  name: string
  /** Agency stop code, used in export filenames when present. */
  code?: string
  /** Which way vehicles face here — feeds the `{direction}` title token. */
  direction?: string
  /** Shared by both sides of one shelter, for grouping them in the stop list. */
  placeId?: string
}

/** Weekday / weekend / daily / school-day — agencies differ, so this is open. */
export interface DayType {
  id: string
  label: string
}

/** Departures for one line, at one stop, on one kind of day. */
export interface Departures {
  routeId: string
  stopId: string
  dayTypeId: string
  times: Minutes[]
}

export const departuresKey = (routeId: string, stopId: string, dayTypeId: string): string =>
  `${routeId}\u0000${stopId}\u0000${dayTypeId}`

/**
 * Everything imported from the source timetable. Held separately from the
 * template so re-importing fresh data never disturbs design work.
 */
export interface Timetable {
  routes: Route[]
  stops: Stop[]
  dayTypes: DayType[]
  departures: Map<string, Minutes[]>
}

export const emptyTimetable = (): Timetable => ({
  routes: [],
  stops: [],
  dayTypes: [],
  departures: new Map(),
})

export const getDepartures = (t: Timetable, routeId: string, stopId: string, dayTypeId: string): Minutes[] =>
  t.departures.get(departuresKey(routeId, stopId, dayTypeId)) ?? []

/** Which lines actually call at a stop, in timetable order. */
export const routesAtStop = (t: Timetable, stopId: string): Route[] =>
  t.routes.filter((r) => t.dayTypes.some((d) => getDepartures(t, r.id, stopId, d.id).length > 0))

/** Which kinds of day a given line runs at a given stop. */
export const dayTypesForRouteAtStop = (t: Timetable, routeId: string, stopId: string): DayType[] =>
  t.dayTypes.filter((d) => getDepartures(t, routeId, stopId, d.id).length > 0)
