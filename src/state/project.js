// Project state: the whole network (stops, routes, schematic settings) lives in
// one serialisable object so it can be saved to localStorage and exported.

import { haversine } from '../lib/geo.js'

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
  return { stopIds: [], legs: [] }
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
  return { ...dir, legs }
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

export function mergeIncomingStops(existing, incoming, mergeRadius) {
  const out = existing.slice()
  let added = 0
  let merged = 0
  for (const stop of incoming) {
    const dup = out.find(
      (s) =>
        (s.osmId && s.osmId === stop.osmId) ||
        (mergeRadius > 0 &&
          normaliseName(s.name) === normaliseName(stop.name) &&
          haversine([s.lat, s.lon], [stop.lat, stop.lon]) <= mergeRadius),
    )
    if (dup) {
      if (!dup.refs.includes(stop.osmId)) {
        dup.refs = [...dup.refs, stop.osmId]
        // Average the platforms so a merged stop sits between both kerbs.
        const n = dup.refs.length
        dup.lat = (dup.lat * (n - 1) + stop.lat) / n
        dup.lon = (dup.lon * (n - 1) + stop.lon) / n
        merged += 1
      }
      continue
    }
    out.push({ ...stop })
    added += 1
  }
  return { stops: out, added, merged }
}

function normaliseName(name) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ')
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
          const keep = dir.stopIds.map((id, i) => [id, i]).filter(([id]) => id !== action.id)
          dirs[key] = normaliseDirection({
            stopIds: keep.map(([id]) => id),
            legs: [], // geometry around the hole has to be recomputed
          })
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
        if (dir.stopIds[dir.stopIds.length - 1] === action.stopId) return dir
        return { ...dir, stopIds: [...dir.stopIds, action.stopId] }
      })

    case 'insertStop':
      return mapDirection(state, action.routeId, action.dirKey, (dir) => {
        const stopIds = dir.stopIds.slice()
        stopIds.splice(action.index, 0, action.stopId)
        const legs = dir.legs.slice()
        // The leg we split and the new one both need routing again.
        legs.splice(Math.max(0, action.index - 1), 1, pendingLeg(), pendingLeg())
        return { stopIds, legs }
      })

    case 'removeStopAt':
      return mapDirection(state, action.routeId, action.dirKey, (dir) => {
        const stopIds = dir.stopIds.slice()
        stopIds.splice(action.index, 1)
        const legs = dir.legs.slice()
        legs.splice(Math.max(0, action.index - 1), 2, pendingLeg())
        return { stopIds, legs }
      })

    case 'moveStopInDir':
      return mapDirection(state, action.routeId, action.dirKey, (dir) => {
        const stopIds = dir.stopIds.slice()
        const to = action.index + action.delta
        if (to < 0 || to >= stopIds.length) return dir
        const [id] = stopIds.splice(action.index, 1)
        stopIds.splice(to, 0, id)
        return { stopIds, legs: [] }
      })

    case 'setDirStops':
      return mapDirection(state, action.routeId, action.dirKey, () => ({
        stopIds: action.stopIds,
        legs: action.legs || [],
      }))

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
      const stopIds = fwd.stopIds.slice().reverse()
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
      return mapDirection(state, action.routeId, 'bwd', () => ({ stopIds, legs }))
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
  project.stops = (raw.stops || []).map((s) => ({ refs: [], ...s }))
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
