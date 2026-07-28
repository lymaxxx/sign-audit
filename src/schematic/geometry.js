// Path geometry for the schematic renderer: parallel offsets for lines that
// share a corridor, rounded / organic corners, and arrow placement.

export function unit(ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy) || 1
  return { x: dx / len, y: dy / len, len }
}

// Shift every segment sideways by its own offset, then reconnect the segments
// by intersecting neighbouring offset lines (a mitre join).
export function offsetPolyline(points, offsets) {
  if (points.length < 2) return points.slice()
  const segs = []
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const u = unit(a.x, a.y, b.x, b.y)
    const nx = -u.y
    const ny = u.x
    const o = offsets[i] || 0
    segs.push({
      a: { x: a.x + nx * o, y: a.y + ny * o },
      b: { x: b.x + nx * o, y: b.y + ny * o },
      dx: u.x,
      dy: u.y,
    })
  }
  const out = [segs[0].a]
  for (let i = 1; i < segs.length; i++) {
    const p = segs[i - 1]
    const q = segs[i]
    const cross = p.dx * q.dy - p.dy * q.dx
    if (Math.abs(cross) < 1e-6) {
      out.push({ x: (p.b.x + q.a.x) / 2, y: (p.b.y + q.a.y) / 2 })
      continue
    }
    const t = ((q.a.x - p.a.x) * q.dy - (q.a.y - p.a.y) * q.dx) / cross
    let x = p.a.x + p.dx * t
    let y = p.a.y + p.dy * t
    // Guard against runaway mitres on very sharp turns.
    const limit = Math.hypot(p.b.x - q.a.x, p.b.y - q.a.y) + 40
    if (Math.hypot(x - p.b.x, y - p.b.y) > limit) {
      x = (p.b.x + q.a.x) / 2
      y = (p.b.y + q.a.y) / 2
    }
    out.push({ x, y })
  }
  out.push(segs[segs.length - 1].b)
  return out
}

export function dedupePoints(points, epsilon = 0.01) {
  const out = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > epsilon) out.push(p)
  }
  return out
}

// fullness: 0 = circular arc, 1 = soft "squircle"/organic corner.
export function roundedPath(rawPoints, radius, fullness = 0) {
  const points = dedupePoints(rawPoints)
  if (points.length < 2) return ''
  if (points.length === 2 || radius <= 0) {
    return `M ${fmt(points[0])} ` + points.slice(1).map((p) => `L ${fmt(p)}`).join(' ')
  }
  const k = 0.5523 * (1 - fullness) + 0.1 * fullness
  let d = `M ${fmt(points[0])}`
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]
    const cur = points[i]
    const next = points[i + 1]
    const u1 = unit(cur.x, cur.y, prev.x, prev.y)
    const u2 = unit(cur.x, cur.y, next.x, next.y)
    const turn = Math.abs(Math.PI - Math.acos(clamp(u1.x * u2.x + u1.y * u2.y, -1, 1)))
    if (turn < 0.02) {
      d += ` L ${fmt(cur)}`
      continue
    }
    const r = Math.min(radius, u1.len * 0.48, u2.len * 0.48)
    const a = { x: cur.x + u1.x * r, y: cur.y + u1.y * r }
    const b = { x: cur.x + u2.x * r, y: cur.y + u2.y * r }
    const c1 = { x: a.x + (cur.x - a.x) * k, y: a.y + (cur.y - a.y) * k }
    const c2 = { x: b.x + (cur.x - b.x) * k, y: b.y + (cur.y - b.y) * k }
    d += ` L ${fmt(a)} C ${fmt(c1)} ${fmt(c2)} ${fmt(b)}`
  }
  d += ` L ${fmt(points[points.length - 1])}`
  return d
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

function fmt(p) {
  return `${round(p.x)} ${round(p.y)}`
}

function round(v) {
  return Math.round(v * 100) / 100
}

// Arrow anchors along a two-point (or short) run, spaced roughly `spacing`.
export function arrowAnchors(a, b, spacing) {
  const u = unit(a.x, a.y, b.x, b.y)
  const count = Math.max(1, Math.floor(u.len / spacing))
  const anchors = []
  for (let i = 1; i <= count; i++) {
    const t = (i / (count + 1)) * u.len
    anchors.push({
      x: a.x + u.x * t,
      y: a.y + u.y * t,
      angle: (Math.atan2(u.y, u.x) * 180) / Math.PI,
    })
  }
  return anchors
}

export function rectsOverlap(a, b, pad = 0) {
  return !(
    a.x + a.w + pad < b.x ||
    b.x + b.w + pad < a.x ||
    a.y + a.h + pad < b.y ||
    b.y + b.h + pad < a.y
  )
}

// Rough text width — good enough for greedy label placement.
export function textWidth(text, fontSize) {
  return text.length * fontSize * 0.55
}
