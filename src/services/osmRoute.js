// Imports an existing OpenStreetMap public-transport route (a `route` or
// `route_master` relation — the same data that powers the route list you get
// when clicking a stop on openstreetmap.org) as a ready-to-edit route.
//
// This is necessarily best-effort: OSM route relations vary a lot in how
// carefully their member order and roles are maintained. Stops are recovered
// reliably (they're just tagged nodes), but the road geometry depends on
// chaining the relation's way members end-to-end, which can fail locally on
// a messy relation — any section that doesn't chain cleanly is simply left
// for the app's own OSRM-based auto-routing to fill in, the same as a
// section drawn by hand.

import { haversine } from '../lib/geo.js'
import { kindOfRoute, queryOverpass } from './overpass.js'

export function parseRelationRef(input) {
  const m = String(input).match(/(\d+)\s*$/)
  if (!m) return null
  return Number(m[1])
}

const STOP_ROLES = ['stop', 'stop_entry_only', 'stop_exit_only']
const PLATFORM_ROLES = ['platform', 'platform_entry_only', 'platform_exit_only']

function isStopRole(role) {
  return STOP_ROLES.some((r) => role === r || role.startsWith(`${r}:`))
}
function isPlatformRole(role) {
  return PLATFORM_ROLES.some((r) => role === r || role.startsWith(`${r}:`))
}

// Accepts one ID or several — a route_master's two direction relations are
// fetched together in a single request/mirror-race rather than one each, so
// a slow query doesn't get paid for twice (or three times, counting the
// initial lookup) in a row.
async function fetchRelationElements(relIds, opts) {
  const ids = (Array.isArray(relIds) ? relIds : [relIds]).join(',')
  const query = `[out:json][timeout:60];relation(id:${ids});(._;>;);out geom;`
  const json = await queryOverpass(query, opts)
  return json.elements || []
}

// Chains way geometries end-to-end into one polyline. Ways in a relation
// aren't guaranteed to be in travel order or orientation, so this walks
// outward from the first way, at each step picking whichever remaining way
// (in either direction) connects to the current chain's free end within
// `tolerance` metres. A way that doesn't connect to anything yet is appended
// as-is (better a small jump than losing that section's geometry outright).
function chainWays(wayGeometries, tolerance = 40) {
  if (!wayGeometries.length) return []
  const remaining = wayGeometries.map((g) => g.slice())
  const chain = remaining.shift()

  const endsMatch = (a, b) => haversine(a, b) <= tolerance

  let guard = remaining.length * 2 + 4
  while (remaining.length && guard-- > 0) {
    const head = chain[0]
    const tail = chain[chain.length - 1]
    let bestIdx = -1
    let bestMode = null
    for (let i = 0; i < remaining.length; i++) {
      const w = remaining[i]
      if (endsMatch(tail, w[0])) {
        bestIdx = i
        bestMode = 'append'
        break
      }
      if (endsMatch(tail, w[w.length - 1])) {
        bestIdx = i
        bestMode = 'appendReversed'
        break
      }
      if (endsMatch(head, w[w.length - 1])) {
        bestIdx = i
        bestMode = 'prepend'
        break
      }
      if (endsMatch(head, w[0])) {
        bestIdx = i
        bestMode = 'prependReversed'
        break
      }
    }
    if (bestIdx === -1) {
      // Nothing connects — bolt the next unused way onto the end anyway so
      // its geometry isn't lost; the resulting jump just won't get used for
      // the leg(s) that would have crossed it (closestVertexIndex will pick
      // whichever side the stop is actually nearest to).
      const w = remaining.shift()
      chain.push(...w)
      continue
    }
    const [w] = remaining.splice(bestIdx, 1)
    if (bestMode === 'append') chain.push(...w.slice(1))
    else if (bestMode === 'appendReversed') chain.push(...w.slice(0, -1).reverse())
    else if (bestMode === 'prepend') chain.unshift(...w.slice(0, -1))
    else chain.unshift(...w.slice(1).reverse())
  }
  return chain
}

function closestIndex(line, point) {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < line.length; i++) {
    const d = haversine(line[i], point)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return { index: best, distance: bestD }
}

// Groups adjacent stop/platform members that describe the same physical
// stop (a PTv2 stop_position + platform pair) into a single record, and
// picks a name for it.
function collapseStopMembers(records, tolerance = 60) {
  const out = []
  for (const rec of records) {
    const prev = out[out.length - 1]
    if (prev && haversine([prev.lat, prev.lon], [rec.lat, rec.lon]) <= tolerance) {
      if (!prev.name && rec.name) prev.name = rec.name
      if (!prev.osmId) prev.osmId = rec.osmId
      continue
    }
    out.push({ ...rec })
  }
  return out
}

function buildFromRelation(rel, elements, opts = {}) {
  const nodeById = new Map()
  const wayById = new Map()
  for (const el of elements) {
    if (el.type === 'node') nodeById.set(el.id, el)
    else if (el.type === 'way') wayById.set(el.id, el)
  }

  const tags = rel.tags || {}
  const defaultKind = opts.kindOverride || kindOfRoute(tags.route)

  const stopRecords = []
  const wayGeometries = []
  for (const member of rel.members || []) {
    const role = member.role || ''
    if (member.type === 'node' && (isStopRole(role) || isPlatformRole(role) || role === '')) {
      const node = nodeById.get(member.ref)
      if (!node || node.lat === undefined) continue
      const nodeTags = node.tags || {}
      // A bare (roleless) node member is unusual but appears in a few older
      // relations still using PTv1 tagging; treat it as a stop too.
      stopRecords.push({
        osmId: `n${node.id}`,
        name: nodeTags.name || nodeTags['name:en'] || nodeTags.ref || '',
        lat: node.lat,
        lon: node.lon,
        kind: nodeTags.railway || nodeTags.amenity ? undefined : defaultKind,
      })
    } else if (member.type === 'way') {
      const way = wayById.get(member.ref)
      if (way?.geometry?.length) {
        wayGeometries.push(way.geometry.map((g) => [g.lat, g.lon]))
      }
    }
  }

  const stops = collapseStopMembers(stopRecords).map((s) => ({ ...s, kind: s.kind || defaultKind }))
  const routeLine = chainWays(wayGeometries)

  // Slice the assembled line between each consecutive pair of stops. A leg
  // is only trusted if the stops land in increasing order along the line
  // (out-of-order or unmatched sections are left for OSRM to fill in).
  const legs = []
  let cursor = 0
  for (let i = 0; i < stops.length - 1; i++) {
    if (!routeLine.length) {
      legs.push({ pending: true })
      continue
    }
    const a = closestIndex(routeLine, [stops[i].lat, stops[i].lon])
    const b = closestIndex(routeLine, [stops[i + 1].lat, stops[i + 1].lon])
    if (b.index > a.index && a.index >= cursor - 2) {
      legs.push({ coords: routeLine.slice(a.index, b.index + 1), pending: false })
      cursor = b.index
    } else {
      legs.push({ pending: true })
    }
  }

  return {
    ref: tags.ref || tags.route_ref || '',
    name: tags.name || '',
    colour: tags.colour || null,
    kind: defaultKind,
    stops,
    legs,
  }
}

// Fetches a route (or, if given a route_master, its two direction children)
// ready to hand to the project reducer. Returns:
//   { ref, name, kind, fwd: {stops, legs}, bwd: {stops, legs} | null }
export async function fetchOsmRoute(input, opts = {}) {
  const relId = parseRelationRef(input)
  if (!relId) throw new Error('That doesn\'t look like an OSM relation ID or URL.')

  const elements = await fetchRelationElements(relId, opts)
  const rel = elements.find((e) => e.type === 'relation' && e.id === relId)
  if (!rel) {
    throw new Error(`Relation ${relId} wasn't found (or isn't a public transport route).`)
  }

  if (rel.tags?.type === 'route_master') {
    const childIds = (rel.members || []).filter((m) => m.type === 'relation').map((m) => m.ref)
    if (!childIds.length) throw new Error('This route_master has no route relations in it.')
    const kindOverride = kindOfRoute(rel.tags.route_master)
    // Both directions in one request rather than one each — the previous
    // version fetched them as two fully separate round-trips (three,
    // counting this master lookup), so a slow query paid its cost twice over.
    const childElements = await fetchRelationElements(childIds, opts)
    const childRoutes = childIds
      .map((id) => childElements.find((e) => e.type === 'relation' && e.id === id))
      .filter(Boolean)
      .map((childRel) => buildFromRelation(childRel, childElements, { kindOverride }))
    const [first, second] = childRoutes
    if (!first) throw new Error('Could not read either direction of this route_master.')
    return {
      ref: rel.tags.ref || first.ref,
      name: rel.tags.name || first.name,
      colour: first.colour,
      kind: first.kind,
      fwd: { stops: first.stops, legs: first.legs },
      bwd: second ? { stops: second.stops, legs: second.legs } : null,
    }
  }

  if (rel.tags?.type !== 'route') {
    throw new Error(`Relation ${relId} is a "${rel.tags?.type || 'unknown'}", not a route.`)
  }

  const built = buildFromRelation(rel, elements, opts)
  return {
    ref: built.ref,
    name: built.name,
    colour: built.colour,
    kind: built.kind,
    fwd: { stops: built.stops, legs: built.legs },
    bwd: null,
  }
}
