// Project state: the whole network (stops, routes, schematic settings) lives in
// one serialisable object so it can be saved to localStorage and exported.

import { haversine } from '../lib/geo.js'
import { baseStopName, platformQualifier, stopGroupKey } from '../lib/stopNames.js'

export const PALETTE = [
  '#e4002b',
  '#0072ce',
  '#00953b',
  '#f2a900',
  '#8f4199',
  '#00a3ad',
  '#e87722',
  '#6b3d1f',
  '#ee2e77',
  '#0f2b5b',
  '#94c11f',
  '#7d868c',
]

let counter = 0
export function newId(prefix) {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.floor(
    Math.random() * 1296,
  ).toString(36)}`
}

export const defaultSchematic = {
  angleStep: 45,
  iterations: 40,
  edgeLength: 92,
  strictness: 2.2,
  seed: 1,
  rotation: 0, // display-only rotation in degrees, around the diagram centroid
  lineWidth: 8,
  lineGap: 9,
  cornerRadius: 22,
  cornerFullness: 0.55, // 0 = crisp arc, 1 = organic / squircle-like
  casing: true,
  casingWidth: 3,
  background: '#ffffff',
  lineOpacity: 1,
  regularStop: {
    shape: 'tick', // tick | dot | ring | none
    size: 7,
    color: '#ffffff',
    stroke: '#1a1a1a',
    strokeWidth: 2,
    useRouteColor: true,
  },
  interchangeStop: {
    shape: 'circle', // circle | ring | capsule | square
    size: 10,
    color: '#ffffff',
    stroke: '#1a1a1a',
    strokeWidth: 3,
    useRouteColor: false,
  },
  legend: {
    show: true,
    size: 13,
  },
  labels: {
    show: true,
    size: 12,
    color: '#111111',
    halo: '#ffffff',
    haloWidth: 3,
    angle: 0,
    bold: 'interchange', // none | interchange | all
    maxChars: 28,
    preferredSide: 'right', // right | left | above | below — default tick/label direction
  },
  arrows: {
    show: true,
    size: 9,
    spacing: 140,
  },
  badges: {
    show: true,
    size: 13,
  },
  roads: {
    show: false, // opt-in background layer, schematic-space only (not geography)
    color: '#c9c9c9',
    width: 4,
    opacity: 0.6,
  },
}

export function emptyProject() {
  return {
    version: 1,
    name: 'Untitled network',
    bbox: null,
    stops: [],
    routes: [],
    schematic: { ...defaultSchematic },
    overrides: {}, // stopId -> [x, y] manual schematic positions
    mapView: { center: [52.52, 13.405], zoom: 13 },
  }
}

export function emptyDirection() {
  return { stopIds: [], platformIds: [], legs: [] }
}

// A direction is stored as two parallel arrays (stop + which platform of that
// stop is used). These helpers keep them in step: every mutation happens on a
// list of {stopId, platformId} pairs.
export function dirEntries(dir) {
  if (!dir) return []
  return dir.stopIds.map((stopId, i) => ({
    stopId,
    platformId: dir.platformIds?.[i] ?? null,
  }))
}

function fromEntries(entries, legs) {
  return {
    stopIds: entries.map((e) => e.stopId),
    platformIds: entries.map((e) => e.platformId ?? null),
    legs,
  }
}

export function makeRoute(index) {
  return {
    id: newId('r'),
    number: String(index + 1),
    name: 'New route',
    color: PALETTE[index % PALETTE.length],
    mode: 'bus',
    snap: true,
    visible: true,
    dirs: { fwd: emptyDirection(), bwd: null },
  }
}

function pendingLeg() {
  return { vias: [], coords: null, status: 'pending' }
}

// Keep legs[] in sync with stopIds[]: there is exactly one leg between each
// consecutive pair of stops.
function normaliseDirection(dir) {
  if (!dir) return dir
  const want = Math.max(0, dir.stopIds.length - 1)
  const legs = dir.legs.slice(0, want)
  while (legs.length < want) legs.push(pendingLeg())
  const platformIds = dir.stopIds.map((_, i) => dir.platformIds?.[i] ?? null)
  return { ...dir, platformIds, legs }
}

function mapDirection(state, routeId, dirKey, fn) {
  return {
    ...state,
    routes: state.routes.map((r) => {
      if (r.id !== routeId) return r
      const dir = r.dirs[dirKey] || emptyDirection()
      return { ...r, dirs: { ...r.dirs, [dirKey]: normaliseDirection(fn(dir, r)) } }
    }),
  }
}

export function stopById(project, id) {
  return project.stops.find((s) => s.id === id)
}

// Every route that touches a stop (used for interchange markers).
export function routesAtStop(project, stopId) {
  return project.routes.filter((r) =>
    ['fwd', 'bwd'].some((k) => r.dirs[k] && r.dirs[k].stopIds.includes(stopId)),
  )
}

// --- stops and their platforms -------------------------------------------
//
// A stop is a place on the schematic; a platform is a physical pole/kerb with
// its own coordinates. Routes reference a stop *and* the platform they call
// at, so road geometry stays accurate while the diagram shows one marker.

export function makePlatform(record) {
  return {
    id: record.id || newId('p'),
    name: record.name || '',
    lat: record.lat,
    lon: record.lon,
    osmId: record.osmId || null,
    kind: record.kind || 'bus',
  }
}

export function stopFromPlatforms(platforms, id) {
  const lat = platforms.reduce((sum, p) => sum + p.lat, 0) / platforms.length
  const lon = platforms.reduce((sum, p) => sum + p.lon, 0) / platforms.length
  // The tidiest of the platform names becomes the stop name.
  const name =
    platforms
      .map((p) => baseStopName(p.name || ''))
      .filter(Boolean)
      .sort((a, b) => a.length - b.length)[0] || 'Unnamed stop'
  return {
    id: id || newId('s'),
    name,
    lat,
    lon,
    kind: platforms[0].kind || 'bus',
    platforms,
  }
}

export function platformOf(stop, platformId) {
  if (!stop) return null
  const list = stop.platforms || []
  return list.find((p) => p.id === platformId) || null
}

// A stop's name, plus any manually-linked alternate names (the "same stop,
// different name on each side of the road" case) joined with a small arrow so
// it reads as one place with two faces rather than two unrelated names.
export function displayStopName(stop) {
  const alt = stop.altNames || []
  if (!alt.length) return stop.name
  return [stop.name, ...alt].join(' ⇄ ')
}

// "Market Square" for a single-platform stop, "Market Square · east" otherwise.
export function platformLabelFor(stop, platform) {
  const list = stop.platforms || []
  if (list.length <= 1 || !platform) return stop.name
  const index = list.findIndex((p) => p.id === platform.id)
  const qualifier = platformQualifier(platform.name || '') || `platform ${index + 1}`
  return `${stop.name} · ${qualifier}`
}

// Short suffix for a sequence entry, or '' when the stop has one platform.
export function entryPlatformSuffix(project, entry) {
  const stop = stopById(project, entry.stopId)
  if (!stop || (stop.platforms || []).length <= 1) return ''
  const platform = platformOf(stop, entry.platformId)
  if (!platform) return 'any platform'
  const index = stop.platforms.findIndex((p) => p.id === platform.id)
  return platformQualifier(platform.name || '') || `platform ${index + 1}`
}

// Coordinates a route should be routed through for this sequence entry.
export function entryPoint(project, entry) {
  const stop = stopById(project, entry.stopId)
  if (!stop) return null
  const platform = platformOf(stop, entry.platformId)
  return platform ? [platform.lat, platform.lon] : [stop.lat, stop.lon]
}

function dedupeNames(names, exclude) {
  const seen = new Set([exclude])
  const out = []
  for (const n of names) {
    if (!n || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

function normaliseHexColor(value) {
  if (!value) return null
  const hex = value.startsWith('#') ? value : `#${value}`
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : null
}

// Turns a list of {stopId, platformId} (where each entry resolved to after
// merging) plus the importer's per-leg geometry into a route direction,
// collapsing any stops that resolved to the very same place back-to-back
// (can happen when two OSM stop members turn out to be the same merged
// stop). A leg is only trusted as-is when neither of its endpoints just got
// collapsed — anywhere that's uncertain simply falls back to auto-routing,
// same as a leg drawn by hand.
function buildDirFromResolved(resolvedStops, fetchedLegs) {
  const entries = []
  const legs = []
  resolvedStops.forEach((r, i) => {
    const prev = entries[entries.length - 1]
    if (prev && prev.stopId === r.stopId) {
      prev.dirty = true
      return
    }
    if (entries.length > 0) {
      const leg = fetchedLegs[i - 1]
      const trusted = !prev.dirty && leg && !leg.pending
      legs.push(trusted ? { vias: [], coords: leg.coords, status: 'road' } : pendingLeg())
    }
    entries.push({ stopId: r.stopId, platformId: r.platformId, dirty: false })
  })
  return {
    stopIds: entries.map((e) => e.stopId),
    platformIds: entries.map((e) => e.platformId),
    legs,
  }
}

function nearestPlatformDistance(stop, lat, lon) {
  return (stop.platforms || []).reduce(
    (min, p) => Math.min(min, haversine([p.lat, p.lon], [lat, lon])),
    Infinity,
  )
}

// Adds freshly downloaded platform records to the existing stops, folding
// same-name platforms within `mergeRadius` into one stop. `resolved` mirrors
// `incoming` 1:1 with where each record ended up — used by the OSM route
// importer to know which stop/platform each stop it just fetched now is.
export function mergeIncomingStops(existing, incoming, mergeRadius) {
  const out = existing.map((s) => ({ ...s, platforms: (s.platforms || []).slice() }))
  const keyed = new Map()
  out.forEach((stop, i) => {
    const key = stopGroupKey(stop.name)
    if (!keyed.has(key)) keyed.set(key, [])
    keyed.get(key).push(i)
  })

  let added = 0
  let merged = 0
  const resolved = []
  for (const record of incoming) {
    const known = out.find((s) => (s.platforms || []).some((p) => p.osmId && p.osmId === record.osmId))
    if (known) {
      const platform = known.platforms.find((p) => p.osmId === record.osmId)
      resolved.push({ stopId: known.id, platformId: platform.id })
      continue
    }

    const key = stopGroupKey(record.name)
    const candidates = mergeRadius > 0 ? keyed.get(key) || [] : []
    let host = null
    let hostDist = Infinity
    for (const i of candidates) {
      const d = nearestPlatformDistance(out[i], record.lat, record.lon)
      if (d <= mergeRadius && d < hostDist) {
        host = i
        hostDist = d
      }
    }

    const platform = makePlatform(record)
    if (host !== null) {
      out[host] = stopFromPlatforms([...out[host].platforms, platform], out[host].id)
      resolved.push({ stopId: out[host].id, platformId: platform.id })
      merged += 1
    } else {
      const stop = stopFromPlatforms([platform])
      out.push(stop)
      resolved.push({ stopId: stop.id, platformId: platform.id })
      if (!keyed.has(key)) keyed.set(key, [])
      keyed.get(key).push(out.length - 1)
      added += 1
    }
  }
  return { stops: out, added, merged, resolved }
}

// Re-groups stops that are already in the project (used by "merge duplicate
// stops"). Returns the new stop list plus a map from every old stop id to the
// stop/platform that replaced it, so routes can be rewritten.
export function groupExistingStops(stops, mergeRadius) {
  const groups = []
  const remap = new Map()

  for (const stop of stops) {
    const platforms = (stop.platforms || []).length
      ? stop.platforms
      : [makePlatform({ name: stop.name, lat: stop.lat, lon: stop.lon, kind: stop.kind })]
    const key = stopGroupKey(stop.name)
    let host = null
    let hostDist = Infinity
    if (mergeRadius > 0) {
      for (const group of groups) {
        if (group.key !== key) continue
        const d = group.platforms.reduce(
          (min, p) => Math.min(min, haversine([p.lat, p.lon], [stop.lat, stop.lon])),
          Infinity,
        )
        if (d <= mergeRadius && d < hostDist) {
          host = group
          hostDist = d
        }
      }
    }
    if (host) {
      host.platforms.push(...platforms)
      host.sources.push(stop)
    } else {
      groups.push({ key, platforms: platforms.slice(), sources: [stop], id: stop.id })
    }
  }

  const merged = groups.map((group) => stopFromPlatforms(group.platforms, group.id))
  groups.forEach((group, i) => {
    const stop = merged[i]
    for (const source of group.sources) {
      // A stop that had exactly one platform keeps pointing at that platform,
      // so existing route geometry stays exactly where it was.
      const own = (source.platforms || []).length
        ? source.platforms
        : stop.platforms.filter((p) => p.name === source.name)
      remap.set(source.id, {
        stopId: stop.id,
        platformId: own.length === 1 ? own[0].id : null,
      })
    }
  })

  return { stops: merged, remap, groupsMerged: stops.length - merged.length }
}

export function projectReducer(state, action) {
  switch (action.type) {
    case 'load':
      return migrate(action.project)

    case 'reset':
      return emptyProject()

    case 'rename':
      return { ...state, name: action.name }

    case 'setBbox':
      return { ...state, bbox: action.bbox }

    case 'setMapView':
      return { ...state, mapView: action.view }

    case 'addStops': {
      const { stops, added, merged } = mergeIncomingStops(
        state.stops.map((s) => ({ ...s })),
        action.stops,
        action.mergeRadius ?? 0,
      )
      return { ...state, stops, lastImport: { added, merged, at: Date.now() } }
    }

    // Drops in a route parsed from an OSM relation (see src/services/osmRoute.js):
    // its stops are merged into the project like any other import, and its
    // legs keep the real OSM road/rail geometry where the importer managed to
    // chain it, falling back to normal OSRM auto-routing where it couldn't.
    case 'importOsmRoute': {
      const fetched = action.route
      const incoming = [...fetched.fwd.stops, ...(fetched.bwd ? fetched.bwd.stops : [])]
      const { stops, resolved, added, merged } = mergeIncomingStops(
        state.stops.map((s) => ({ ...s })),
        incoming,
        action.mergeRadius ?? 30,
      )
      const fwdResolved = resolved.slice(0, fetched.fwd.stops.length)
      const bwdResolved = fetched.bwd ? resolved.slice(fetched.fwd.stops.length) : []

      const route = {
        id: newId('r'),
        number: fetched.ref || String(state.routes.length + 1),
        name: fetched.name || 'Imported route',
        color: normaliseHexColor(fetched.colour) || PALETTE[state.routes.length % PALETTE.length],
        mode: fetched.kind || 'bus',
        snap: true,
        visible: true,
        dirs: {
          fwd: normaliseDirection(buildDirFromResolved(fwdResolved, fetched.fwd.legs)),
          bwd: fetched.bwd ? normaliseDirection(buildDirFromResolved(bwdResolved, fetched.bwd.legs)) : null,
        },
      }

      return {
        ...state,
        stops,
        routes: [...state.routes, route],
        lastImport: { added, merged, at: Date.now(), routeImported: route.id },
      }
    }

    case 'addStop':
      return { ...state, stops: [...state.stops, action.stop] }

    case 'updateStop':
      return {
        ...state,
        stops: state.stops.map((s) => (s.id === action.id ? { ...s, ...action.patch } : s)),
      }

    case 'deleteStop': {
      const routes = state.routes.map((r) => {
        const dirs = {}
        for (const key of ['fwd', 'bwd']) {
          const dir = r.dirs[key]
          if (!dir) {
            dirs[key] = dir
            continue
          }
          const keep = dirEntries(dir).filter((entry) => entry.stopId !== action.id)
          // geometry around the hole has to be recomputed
          dirs[key] = normaliseDirection(fromEntries(keep, []))
        }
        return { ...r, dirs }
      })
      const overrides = { ...state.overrides }
      delete overrides[action.id]
      return {
        ...state,
        overrides,
        stops: state.stops.filter((s) => s.id !== action.id),
        routes,
      }
    }

    case 'clearStops':
      return { ...state, stops: [], routes: [], overrides: {} }

    case 'regroupStops': {
      const { stops, remap, groupsMerged } = groupExistingStops(
        state.stops,
        action.mergeRadius ?? 0,
      )
      const routes = state.routes.map((route) => {
        const dirs = {}
        for (const key of ['fwd', 'bwd']) {
          const dir = route.dirs[key]
          if (!dir) {
            dirs[key] = dir
            continue
          }
          const entries = []
          const legs = dir.legs.slice()
          dirEntries(dir).forEach((entry, i) => {
            const target = remap.get(entry.stopId)
            if (!target) {
              entries.push(entry)
              return
            }
            const next = {
              stopId: target.stopId,
              // an explicit platform survives the merge; otherwise inherit the
              // one this stop contributed
              platformId: entry.platformId ?? target.platformId ?? null,
            }
            const prev = entries[entries.length - 1]
            if (prev && prev.stopId === next.stopId) {
              // two platforms of the same stop in a row collapse into one call
              legs.splice(Math.max(0, i - 1), 2, pendingLeg())
              return
            }
            entries.push(next)
          })
          dirs[key] = normaliseDirection(fromEntries(entries, legs))
        }
        return { ...route, dirs }
      })
      const overrides = {}
      for (const [stopId, pos] of Object.entries(state.overrides)) {
        const target = remap.get(stopId)
        if (target) overrides[target.stopId] = pos
      }
      return {
        ...state,
        stops,
        routes,
        overrides,
        lastImport: { added: 0, merged: groupsMerged, at: Date.now(), regrouped: true },
      }
    }

    // Manually declares two stops to be the same physical place with
    // different names on each side (the "Gibraltar case") — automatic
    // grouping only catches names that differ by a recognisable qualifier, so
    // this is for names that are simply unrelated. `keepId` keeps its
    // identity (and any of its own alt names); `mergeId`'s name is folded in
    // as an alt name rather than discarded, and its platforms join keepId's.
    case 'linkStops': {
      const keep = state.stops.find((s) => s.id === action.keepId)
      const other = state.stops.find((s) => s.id === action.mergeId)
      if (!keep || !other || keep.id === other.id) return state

      const platforms = [...keep.platforms, ...other.platforms]
      const lat = platforms.reduce((sum, p) => sum + p.lat, 0) / platforms.length
      const lon = platforms.reduce((sum, p) => sum + p.lon, 0) / platforms.length
      const altNames = dedupeNames(
        [...(keep.altNames || []), other.name, ...(other.altNames || [])],
        keep.name,
      )
      const merged = { ...keep, lat, lon, platforms, altNames }

      const stops = state.stops.filter((s) => s.id !== other.id).map((s) => (s.id === keep.id ? merged : s))

      // A `null` platformId meant "this stop's own (usually only) platform" —
      // fine before the merge, but the merged stop's centre is now a midpoint
      // between two platforms, so every existing call has to be pinned to the
      // platform it actually meant, or routes would silently jump to that
      // midpoint.
      const keepDefault = keep.platforms[0]?.id ?? null
      const otherDefault = other.platforms[0]?.id ?? null
      const routes = state.routes.map((route) => {
        const dirs = {}
        for (const key of ['fwd', 'bwd']) {
          const dir = route.dirs[key]
          if (!dir) {
            dirs[key] = dir
            continue
          }
          const entries = dirEntries(dir).map((entry) => {
            if (entry.stopId === other.id) {
              return { stopId: keep.id, platformId: entry.platformId ?? otherDefault }
            }
            if (entry.stopId === keep.id) {
              return { stopId: keep.id, platformId: entry.platformId ?? keepDefault }
            }
            return entry
          })
          dirs[key] = normaliseDirection(fromEntries(entries, dir.legs.slice()))
        }
        return { ...route, dirs }
      })

      const overrides = { ...state.overrides }
      delete overrides[other.id]
      return { ...state, stops, routes, overrides }
    }

    // Undoes a manual link: every platform goes back to a separate stop,
    // grouped by its own name (so two links made at different times split
    // apart independently rather than all the way back to one-platform-each).
    case 'unlinkStop': {
      const stop = state.stops.find((s) => s.id === action.id)
      if (!stop || !(stop.altNames || []).length) return state

      const groups = new Map()
      for (const platform of stop.platforms) {
        const key = stopGroupKey(platform.name || stop.name)
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(platform)
      }
      if (groups.size <= 1) return state

      const groupList = [...groups.values()]
      const newStops = groupList.map((list, i) =>
        i === 0 ? stopFromPlatforms(list, stop.id) : stopFromPlatforms(list),
      )
      const platformToStop = new Map()
      for (const s of newStops) for (const p of s.platforms) platformToStop.set(p.id, s.id)

      const stops = state.stops.filter((s) => s.id !== stop.id).concat(newStops)
      const routes = state.routes.map((route) => {
        const dirs = {}
        for (const key of ['fwd', 'bwd']) {
          const dir = route.dirs[key]
          if (!dir) {
            dirs[key] = dir
            continue
          }
          const entries = dirEntries(dir).map((entry) => {
            if (entry.stopId !== stop.id) return entry
            return { stopId: platformToStop.get(entry.platformId) || newStops[0].id, platformId: entry.platformId }
          })
          dirs[key] = normaliseDirection(fromEntries(entries, dir.legs.slice()))
        }
        return { ...route, dirs }
      })
      const overrides = { ...state.overrides }
      delete overrides[stop.id]
      return { ...state, stops, routes, overrides }
    }

    case 'addRoute': {
      const route = action.route || makeRoute(state.routes.length)
      return { ...state, routes: [...state.routes, route] }
    }

    case 'updateRoute':
      return {
        ...state,
        routes: state.routes.map((r) => (r.id === action.id ? { ...r, ...action.patch } : r)),
      }

    case 'deleteRoute':
      return { ...state, routes: state.routes.filter((r) => r.id !== action.id) }

    case 'moveRoute': {
      const routes = state.routes.slice()
      const from = routes.findIndex((r) => r.id === action.id)
      const to = Math.max(0, Math.min(routes.length - 1, from + action.delta))
      if (from < 0 || from === to) return state
      const [item] = routes.splice(from, 1)
      routes.splice(to, 0, item)
      return { ...state, routes }
    }

    case 'appendStop':
      return mapDirection(state, action.routeId, action.dirKey, (dir) => {
        const entries = dirEntries(dir)
        const last = entries[entries.length - 1]
        // Clicking the same platform twice in a row is a slip, not a stop.
        if (last && last.stopId === action.stopId && last.platformId === (action.platformId ?? null)) {
          return dir
        }
        entries.push({ stopId: action.stopId, platformId: action.platformId ?? null })
        return fromEntries(entries, dir.legs.slice())
      })

    case 'insertStop':
      return mapDirection(state, action.routeId, action.dirKey, (dir) => {
        const entries = dirEntries(dir)
        entries.splice(action.index, 0, {
          stopId: action.stopId,
          platformId: action.platformId ?? null,
        })
        const legs = dir.legs.slice()
        // The leg we split and the new one both need routing again.
        legs.splice(Math.max(0, action.index - 1), 1, pendingLeg(), pendingLeg())
        return fromEntries(entries, legs)
      })

    case 'setEntryPlatform':
      return mapDirection(state, action.routeId, action.dirKey, (dir) => {
        const entries = dirEntries(dir)
        if (!entries[action.index]) return dir
        entries[action.index] = { ...entries[action.index], platformId: action.platformId }
        const legs = dir.legs.slice()
        // Both legs touching this stop have to be re-routed to the new kerb.
        if (legs[action.index - 1]) legs[action.index - 1] = pendingLeg()
        if (legs[action.index]) legs[action.index] = pendingLeg()
        return fromEntries(entries, legs)
      })

    case 'removeStopAt':
      return mapDirection(state, action.routeId, action.dirKey, (dir) => {
        const entries = dirEntries(dir)
        entries.splice(action.index, 1)
        const legs = dir.legs.slice()
        legs.splice(Math.max(0, action.index - 1), 2, pendingLeg())
        return fromEntries(entries, legs)
      })

    case 'moveStopInDir':
      return mapDirection(state, action.routeId, action.dirKey, (dir) => {
        const entries = dirEntries(dir)
        const to = action.index + action.delta
        if (to < 0 || to >= entries.length) return dir
        const [entry] = entries.splice(action.index, 1)
        entries.splice(to, 0, entry)
        return fromEntries(entries, [])
      })

    case 'setDirStops':
      return mapDirection(state, action.routeId, action.dirKey, () =>
        fromEntries(
          action.entries || (action.stopIds || []).map((id) => ({ stopId: id, platformId: null })),
          action.legs || [],
        ),
      )

    case 'clearDir':
      return mapDirection(state, action.routeId, action.dirKey, () => emptyDirection())

    case 'removeDir':
      return {
        ...state,
        routes: state.routes.map((r) =>
          r.id === action.routeId ? { ...r, dirs: { ...r.dirs, bwd: null } } : r,
        ),
      }

    case 'setLeg':
      return mapDirection(state, action.routeId, action.dirKey, (dir) => {
        const legs = dir.legs.slice()
        legs[action.index] = { ...legs[action.index], ...action.leg }
        return { ...dir, legs }
      })

    case 'addVia':
      return mapDirection(state, action.routeId, action.dirKey, (dir) => {
        const legs = dir.legs.slice()
        const leg = legs[action.index]
        if (!leg) return dir
        const vias = leg.vias.slice()
        vias.splice(action.viaIndex, 0, action.via)
        legs[action.index] = { ...leg, vias, status: 'pending' }
        return { ...dir, legs }
      })

    case 'updateVia':
      return mapDirection(state, action.routeId, action.dirKey, (dir) => {
        const legs = dir.legs.slice()
        const leg = legs[action.index]
        if (!leg) return dir
        const vias = leg.vias.slice()
        if (action.via) vias[action.viaIndex] = action.via
        else vias.splice(action.viaIndex, 1)
        legs[action.index] = { ...leg, vias, status: 'pending' }
        return { ...dir, legs }
      })

    case 'resetLeg':
      return mapDirection(state, action.routeId, action.dirKey, (dir) => {
        const legs = dir.legs.slice()
        if (!legs[action.index]) return dir
        legs[action.index] = pendingLeg()
        return { ...dir, legs }
      })

    case 'reverseAuto': {
      const route = state.routes.find((r) => r.id === action.routeId)
      if (!route) return state
      const fwd = route.dirs.fwd
      const entries = dirEntries(fwd).reverse()
      // Mirror the forward geometry so the reverse path follows the same roads
      // without another routing round-trip.
      const legs = fwd.legs
        .slice()
        .reverse()
        .map((leg) => ({
          vias: leg.vias.slice().reverse(),
          coords: leg.coords ? leg.coords.slice().reverse() : null,
          status: leg.coords ? leg.status : 'pending',
        }))
      return mapDirection(state, action.routeId, 'bwd', () => fromEntries(entries, legs))
    }

    case 'startManualReverse':
      return mapDirection(state, action.routeId, 'bwd', () => emptyDirection())

    case 'setSchematic':
      return { ...state, schematic: deepMerge(state.schematic, action.patch) }

    case 'setOverride': {
      const overrides = { ...state.overrides }
      if (action.pos) overrides[action.stopId] = action.pos
      else delete overrides[action.stopId]
      return { ...state, overrides }
    }

    case 'clearOverrides':
      return { ...state, overrides: {} }

    default:
      return state
  }
}

function deepMerge(base, patch) {
  const out = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(base[k] || {}, v) : v
  }
  return out
}

export function migrate(raw) {
  const base = emptyProject()
  const project = { ...base, ...raw }
  project.schematic = deepMerge(base.schematic, raw.schematic || {})
  project.overrides = raw.overrides || {}
  project.stops = (raw.stops || []).map((stop) => {
    if (stop.platforms?.length) return stop
    // pre-platform projects: the stop itself becomes its only platform
    return stopFromPlatforms(
      [makePlatform({ name: stop.name, lat: stop.lat, lon: stop.lon, kind: stop.kind })],
      stop.id,
    )
  })
  project.routes = (raw.routes || []).map((r, i) => ({
    ...makeRoute(i),
    ...r,
    dirs: {
      fwd: normaliseDirection(r.dirs?.fwd || emptyDirection()),
      bwd: r.dirs?.bwd ? normaliseDirection(r.dirs.bwd) : null,
    },
  }))
  return project
}

const STORAGE_KEY = 'transit-map-generator:project'

export function loadStoredProject() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return migrate(JSON.parse(raw))
  } catch {
    return null
  }
}

export function storeProject(project) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project))
  } catch {
    /* quota exceeded — not fatal, the user can still export manually */
  }
}
