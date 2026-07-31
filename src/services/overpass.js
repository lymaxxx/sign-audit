// Pulls public-transport stops out of OpenStreetMap through Overpass.

import { networkHint } from '../lib/env.js'

export const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

// A mirror that never responds (no error, just silence — surprisingly common
// with the free public Overpass instances) would otherwise hang the request
// forever, since `fetch` has no timeout of its own. This aborts a single
// attempt after `ms` while still honouring the caller's own abort signal.
function withTimeout(externalSignal, ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), ms)
  const onExternalAbort = () => controller.abort(externalSignal.reason)
  externalSignal?.addEventListener('abort', onExternalAbort)
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer)
      externalSignal?.removeEventListener('abort', onExternalAbort)
    },
  }
}

// Posts an Overpass QL query, trying each mirror in turn. Shared by the stop
// importer below and by the OSM route importer.
export async function queryOverpass(query, { signal, timeoutMs = 25000 } = {}) {
  const body = new URLSearchParams({ data: query })
  let lastError = null
  for (const url of ENDPOINTS) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const attempt = withTimeout(signal, timeoutMs)
    try {
      const res = await fetch(url, { method: 'POST', body, signal: attempt.signal })
      if (!res.ok) throw new Error(`Overpass replied ${res.status}`)
      return await res.json()
    } catch (err) {
      if (signal?.aborted) throw err // the caller cancelled — don't keep trying mirrors
      lastError = err.name === 'AbortError' || err.name === 'TimeoutError' ? new Error(`Timed out after ${timeoutMs / 1000}s`) : err
    } finally {
      attempt.cleanup()
    }
  }
  throw new Error(
    `Could not reach any Overpass server (${lastError ? lastError.message : 'unknown error'}). Try again in a moment.${networkHint()}`,
  )
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
