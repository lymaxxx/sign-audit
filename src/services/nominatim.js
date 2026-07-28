// Place search (geocoding) via Nominatim.

import { networkHint } from '../lib/env.js'

export async function searchPlaces(query, { signal } = {}) {
  if (!query.trim()) return []
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('limit', '8')
  url.searchParams.set('addressdetails', '0')
  let res
  try {
    res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new Error(`Search failed: ${err.message}.${networkHint()}`)
  }
  if (!res.ok) throw new Error(`Search failed (${res.status})`)
  const json = await res.json()
  return json.map((item) => ({
    id: `${item.osm_type}${item.osm_id}`,
    label: item.display_name,
    lat: Number(item.lat),
    lon: Number(item.lon),
    // boundingbox is [south, north, west, east]
    bbox: item.boundingbox
      ? [
          Number(item.boundingbox[0]),
          Number(item.boundingbox[2]),
          Number(item.boundingbox[1]),
          Number(item.boundingbox[3]),
        ]
      : null,
  }))
}
