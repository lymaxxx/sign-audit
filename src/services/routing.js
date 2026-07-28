// Road routing between consecutive stops, using the public OSRM demo server.
// Results are cached (in memory + localStorage) because the same leg gets
// re-requested a lot while editing.

import { closestVertexIndex } from '../lib/geo.js'

const BASE = 'https://router.project-osrm.org/route/v1'
const CACHE_KEY = 'transit-map-generator:legcache'
const memory = new Map()

function loadDiskCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return
    for (const [k, v] of Object.entries(JSON.parse(raw))) memory.set(k, v)
  } catch {
    /* ignore corrupt cache */
  }
}
loadDiskCache()

let flushTimer = null
function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    try {
      // Keep the cache bounded — most recent 800 legs is plenty.
      const entries = [...memory.entries()].slice(-800)
      localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)))
    } catch {
      /* ignore quota errors */
    }
  }, 1500)
}

function profileFor(mode) {
  // The demo server only exposes the car profile reliably; trams and trains
  // fall back to straight lines anyway when snapping is switched off.
  return mode === 'foot' ? 'foot' : 'driving'
}

function keyFor(points, mode) {
  return `${profileFor(mode)}:${points.map((p) => p.map((v) => v.toFixed(5)).join(',')).join(';')}`
}

export function straightLeg(points) {
  return { coords: points.map((p) => [p[0], p[1]]), status: 'straight', viaSplits: [] }
}

// points: [[lat, lon], ...] starting at the origin stop, ending at the target
// stop, with any via points in between.
export async function routeThrough(points, mode, { signal } = {}) {
  if (points.length < 2) return straightLeg(points)
  const key = keyFor(points, mode)
  if (memory.has(key)) return memory.get(key)

  const coordString = points.map((p) => `${p[1].toFixed(6)},${p[0].toFixed(6)}`).join(';')
  const url = `${BASE}/${profileFor(mode)}/${coordString}?overview=full&geometries=geojson&continue_straight=false`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Routing failed (${res.status})`)
  const json = await res.json()
  if (json.code !== 'Ok' || !json.routes?.length) {
    throw new Error(json.message || 'No road route found between these stops')
  }
  const coords = json.routes[0].geometry.coordinates.map(([lon, lat]) => [lat, lon])
  // Where each via point ended up along the geometry: used to work out where a
  // newly dragged via belongs in the list.
  const viaSplits = (json.waypoints || [])
    .slice(1, -1)
    .map((w) => closestVertexIndex(coords, [w.location[1], w.location[0]]))
  const result = {
    coords,
    status: 'road',
    viaSplits,
    distance: json.routes[0].distance,
    duration: json.routes[0].duration,
  }
  memory.set(key, result)
  scheduleFlush()
  return result
}

export function clearRouteCache() {
  memory.clear()
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    /* ignore */
  }
}

// Simple sequential queue so we never hammer the public OSRM instance.
const queue = []
let running = false

export function enqueue(task) {
  return new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject })
    pump()
  })
}

async function pump() {
  if (running) return
  running = true
  while (queue.length) {
    const { task, resolve, reject } = queue.shift()
    try {
      resolve(await task())
    } catch (err) {
      reject(err)
    }
    await new Promise((r) => setTimeout(r, 60))
  }
  running = false
}

export function queueLength() {
  return queue.length
}
