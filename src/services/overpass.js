// Pulls public-transport stops out of OpenStreetMap through Overpass.

import { networkHint } from '../lib/env.js'

export const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

// Posts an Overpass QL query to every mirror at once and takes whichever
// answers first — far better latency than trying them one at a time (a
// route relation query can legitimately take 30-60s on a loaded public
// instance, so waiting that long per mirror *in sequence* before even trying
// the next one was the previous version's real bug). Everything else is
// cancelled the moment one succeeds. Bounded by `timeoutMs`, which needs to
// stay *above* the `[timeout:60]` the queries below declare to Overpass
// itself — aborting on the client before the server's own declared budget is
// up guarantees failure on anything that takes 30-60s, which real route
// relations routinely do.
export async function queryOverpass(query, { signal, timeoutMs = 75000 } = {}) {
  const body = new URLSearchParams({ data: query })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), timeoutMs)
  const onExternalAbort = () => controller.abort(signal.reason)
  signal?.addEventListener('abort', onExternalAbort)

  const attempt = async (url) => {
    const res = await fetch(url, { method: 'POST', body, signal: controller.signal })
    if (!res.ok) throw new Error(`Overpass replied ${res.status}`)
    return res.json()
  }

  try {
    const result = await Promise.any(ENDPOINTS.map(attempt))
    controller.abort() // we have a winner — stop the other mirrors
    return result
  } catch (err) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const timedOut = controller.signal.aborted && controller.signal.reason?.name === 'TimeoutError'
    const detail = timedOut
      ? `timed out after ${timeoutMs / 1000}s`
      : err instanceof AggregateError
        ? err.errors[err.errors.length - 1]?.message || 'unknown error'
        : err.message
    throw new Error(
      `Could not reach any Overpass server (${detail}). Try again in a moment.${networkHint()}`,
    )
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onExternalAbort)
  }
}

export const STOP_KINDS = {
  bus: 'Bus stops',
  tram: 'Tram stops',
  rail: 'Train / metro stations',
  ferry: 'Ferry terminals',
}

function queryFor(bbox, kinds) {
  const b = `${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}`
  const parts = []
  if (kinds.bus) {
    parts.push(`node["highway"="bus_stop"](${b});`)
    parts.push(`node["public_transport"="platform"]["bus"="yes"](${b});`)
  }
  if (kinds.tram) {
    parts.push(`node["railway"="tram_stop"](${b});`)
    parts.push(`node["public_transport"="platform"]["tram"="yes"](${b});`)
  }
  if (kinds.rail) {
    parts.push(`node["railway"="station"](${b});`)
    parts.push(`node["railway"="halt"](${b});`)
    parts.push(`node["public_transport"="station"]["subway"="yes"](${b});`)
  }
  if (kinds.ferry) {
    parts.push(`node["amenity"="ferry_terminal"](${b});`)
  }
  if (!parts.length) parts.push(`node["highway"="bus_stop"](${b});`)
  return `[out:json][timeout:60];\n(\n${parts.join('\n')}\n);\nout body;`
}

function kindOf(tags) {
  if (tags.railway === 'tram_stop' || tags.tram === 'yes') return 'tram'
  if (tags.railway === 'station' || tags.railway === 'halt' || tags.subway === 'yes') return 'rail'
  if (tags.amenity === 'ferry_terminal') return 'ferry'
  return 'bus'
}

export async function fetchStops(bbox, kinds, { signal } = {}) {
  const json = await queryOverpass(queryFor(bbox, kinds), { signal })
  return (json.elements || [])
    .filter((el) => el.type === 'node')
    .map((el) => {
      const tags = el.tags || {}
      return {
        osmId: `n${el.id}`,
        name: tags.name || tags['name:en'] || tags.ref || 'Unnamed stop',
        lat: el.lat,
        lon: el.lon,
        kind: kindOf(tags),
        operator: tags.operator || '',
      }
    })
}

export function kindOfRoute(routeTag) {
  if (routeTag === 'tram' || routeTag === 'light_rail') return 'tram'
  if (routeTag === 'train' || routeTag === 'subway' || routeTag === 'monorail') return 'rail'
  if (routeTag === 'ferry') return 'ferry'
  return 'bus'
}

export { kindOf }
