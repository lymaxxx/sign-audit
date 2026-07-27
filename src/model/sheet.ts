import { segmentDayTypes, type AlignedSections } from '../segment'
import { buildRows } from '../layout/rows'
import type { RouteBlockInput } from '../layout/block'
import type { MasterTemplate } from './template'
import { dayTypesForRouteAtStop, getDepartures, routesAtStop, type Timetable } from './types'

/**
 * Per-stop edits, layered over the generated sheet rather than replacing it.
 *
 * Re-importing a fresh timetable rewrites departures and leaves this alone, so
 * a season's worth of hand-tuned titles and notes survives the next data drop.
 */
export interface StopEdits {
  titleOverride?: string
  subtitleOverride?: string
  /** Route ids in the order they should appear; unlisted routes follow. */
  blockOrder?: string[]
  /** Route ids to leave off this stop's sheet. */
  hidden?: string[]
  /** Replace the automatic segmentation for one route and kind of day. */
  sectionOverrides?: Record<string, AlignedSections>
  /** Replace departures outright, keyed the same way. */
  timeEdits?: Record<string, number[]>
}

export const editKey = (routeId: string, dayTypeId: string): string => `${routeId} ${dayTypeId}`

export const emptyEdits = (): StopEdits => ({})

/**
 * Work out what belongs on one stop's sheet.
 *
 * Every route calling there becomes a block; every kind of day it runs becomes
 * a column; the day itself is segmented per column and the results are paired
 * into shared rows so blocks line up with each other.
 */
export const buildSheetBlocks = (
  timetable: Timetable,
  stopId: string,
  tpl: MasterTemplate,
  edits: StopEdits = {},
): RouteBlockInput[] => {
  const hidden = new Set(edits.hidden ?? [])
  let routes = routesAtStop(timetable, stopId).filter((r) => !hidden.has(r.id))

  if (edits.blockOrder?.length) {
    const rank = new Map(edits.blockOrder.map((id, i) => [id, i]))
    routes = [...routes].sort(
      (a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    )
  }

  return routes.map((route) => {
    const dayTypes = dayTypesForRouteAtStop(timetable, route.id, stopId)

    // Segmented as a group, not one column at a time, so the day types share a
    // row structure and the block has no holes in it.
    const times = dayTypes.map(
      (d) => edits.timeEdits?.[editKey(route.id, d.id)] ?? getDepartures(timetable, route.id, stopId, d.id),
    )
    const columns = segmentDayTypes(times, tpl.rules).map((auto, i) => {
      const override = edits.sectionOverrides?.[editKey(route.id, dayTypes[i]!.id)]
      return override ?? auto
    })

    return {
      route,
      dayTypes,
      rows: buildRows(columns, tpl.block, tpl.rules),
    }
  })
}
