// Pulls public-transport stops out of OpenStreetMap through Overpass.

import { networkHint } from '../lib/env.js'

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

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
  const body = new URLSearchParams({ data: queryFor(bbox, kinds) })
  let lastError = null
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, { method: 'POST', body, signal })
      if (!res.ok) throw new Error(`Overpass replied ${res.status}`)
      const json = await res.json()
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
    } catch (err) {
      if (err.name === 'AbortError') throw err
      lastError = err
    }
  }
  throw new Error(
    `Could not reach any Overpass server (${lastError ? lastError.message : 'unknown error'}). Try a smaller area or retry in a moment.${networkHint()}`,
  )
}
