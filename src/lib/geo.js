// Geographic helpers. Coordinates are [lat, lon] pairs unless noted.

const R = 6371000

export function toRad(d) {
  return (d * Math.PI) / 180
}

export function haversine(a, b) {
  const dLat = toRad(b[0] - a[0])
  const dLon = toRad(b[1] - a[1])
  const la1 = toRad(a[0])
  const la2 = toRad(b[0])
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

// Equirectangular projection around a reference latitude. Good enough for a
// city-sized bounding box and keeps the maths cheap for the layout solver.
export function projector(refLat) {
  const k = Math.cos(toRad(refLat))
  return {
    forward: ([lat, lon]) => [lon * k * 111320, lat * 110540],
    inverse: ([x, y]) => [y / 110540, x / (k * 111320)],
  }
}

export function polylineLength(coords) {
  let total = 0
  for (let i = 1; i < coords.length; i++) total += haversine(coords[i - 1], coords[i])
  return total
}

export function bboxFromPoints(points) {
  if (!points.length) return null
  let s = Infinity
  let w = Infinity
  let n = -Infinity
  let e = -Infinity
  for (const p of points) {
    s = Math.min(s, p[0])
    n = Math.max(n, p[0])
    w = Math.min(w, p[1])
    e = Math.max(e, p[1])
  }
  return [s, w, n, e]
}

// Squared distance from point p to segment ab, in plain 2D space.
export function distToSegment2(p, a, b) {
  const vx = b[0] - a[0]
  const vy = b[1] - a[1]
  const wx = p[0] - a[0]
  const wy = p[1] - a[1]
  const len2 = vx * vx + vy * vy
  let t = len2 === 0 ? 0 : (wx * vx + wy * vy) / len2
  t = Math.max(0, Math.min(1, t))
  const dx = p[0] - (a[0] + t * vx)
  const dy = p[1] - (a[1] + t * vy)
  return dx * dx + dy * dy
}

// Index of the polyline vertex closest to `point` (coords are [lat, lon]).
export function closestVertexIndex(coords, point) {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < coords.length; i++) {
    const d = (coords[i][0] - point[0]) ** 2 + (coords[i][1] - point[1]) ** 2
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

// Position along a polyline (as a vertex index) closest to `point`.
export function closestSegmentIndex(coords, point) {
  let best = 0
  let bestD = Infinity
  for (let i = 1; i < coords.length; i++) {
    const d = distToSegment2(point, coords[i - 1], coords[i])
    if (d < bestD) {
      bestD = d
      best = i - 1
    }
  }
  return best
}

export function segmentsIntersect(p1, p2, p3, p4) {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0])
  if (Math.abs(d) < 1e-12) return false
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d
  return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999
}

export function formatDistance(m) {
  if (m < 1000) return `${Math.round(m)} m`
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`
}
