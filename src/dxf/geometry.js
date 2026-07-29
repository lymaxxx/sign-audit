/**
 * 2D affine transforms and DXF entity -> SVG path conversion.
 *
 * Everything is emitted in DXF world coordinates with Y pointing up. PlanView
 * flips the Y axis once at the root <g>, so no code below has to think about
 * it. That also means SVG arc flags here are interpreted in a Y-up space:
 * counter-clockwise (the direction DXF arcs and positive bulges run in) is
 * sweep-flag 1.
 */

const TAU = Math.PI * 2

/* ---------------------------------------------------------------- matrices */

// [a, b, c, d, e, f]  =>  x' = a·x + c·y + e ,  y' = b·x + d·y + f
export const IDENTITY = [1, 0, 0, 1, 0, 0]

/** Matrix equivalent to applying `n` first and then `m`. */
export function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ]
}

export function apply(m, x, y) {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }
}

// Scratch registers for the hot path — transforming a point per vertex across
// a 40k-entity drawing allocates a lot of short-lived objects otherwise.
let px = 0
let py = 0
function xf(m, x, y) {
  px = m[0] * x + m[2] * y + m[4]
  py = m[1] * x + m[3] * y + m[5]
}

/**
 * Placement matrix for an INSERT. Block geometry is defined relative to the
 * block's base point, and scale/rotation act about that point.
 */
export function insertMatrix(insert, basePoint) {
  const t = ((insert.rotation ?? 0) * Math.PI) / 180
  const cos = Math.cos(t)
  const sin = Math.sin(t)
  const sx = insert.xScale ?? 1
  const sy = insert.yScale ?? 1
  const bx = basePoint?.x ?? 0
  const by = basePoint?.y ?? 0
  const ox = insert.position?.x ?? 0
  const oy = insert.position?.y ?? 0

  // T(pos) · R(θ) · S(sx,sy) · T(-base)
  const a = cos * sx
  const b = sin * sx
  const c = -sin * sy
  const d = cos * sy
  return [a, b, c, d, ox - (a * bx + c * by), oy - (b * bx + d * by)]
}

/** Uniform scale factor if `m` is a similarity, otherwise null. */
function similarityScale(m) {
  const col1 = Math.hypot(m[0], m[1])
  const col2 = Math.hypot(m[2], m[3])
  if (col1 < 1e-12 || col2 < 1e-12) return null
  const skew = Math.abs(m[0] * m[2] + m[1] * m[3]) / (col1 * col2)
  if (skew > 1e-6) return null
  if (Math.abs(col1 - col2) / Math.max(col1, col2) > 1e-6) return null
  return col1
}

function determinant(m) {
  return m[0] * m[3] - m[1] * m[2]
}

/* ------------------------------------------------------------------ bounds */

export function emptyBounds() {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
}

export function isEmptyBounds(b) {
  return !b || !Number.isFinite(b.minX) || !Number.isFinite(b.maxX)
}

function track(bounds, x, y) {
  if (x < bounds.minX) bounds.minX = x
  if (y < bounds.minY) bounds.minY = y
  if (x > bounds.maxX) bounds.maxX = x
  if (y > bounds.maxY) bounds.maxY = y
}

/* -------------------------------------------------------------- formatting */

/** Round to 0.001 and drop exponential notation, which SVG paths reject. */
function n(v) {
  if (!Number.isFinite(v)) return '0'
  const r = Math.round(v * 1000) / 1000
  if (Object.is(r, -0)) return '0'
  return Math.abs(r) < 1e-4 ? '0' : String(r)
}

/* --------------------------------------------------------- path primitives */

function moveTo(out, bounds, x, y) {
  track(bounds, x, y)
  out.push(`M${n(x)} ${n(y)}`)
}

function lineTo(out, bounds, x, y) {
  track(bounds, x, y)
  out.push(`L${n(x)} ${n(y)}`)
}

/** How many straight segments to approximate `sweep` radians of a circle. */
function arcSegments(sweep) {
  return Math.min(360, Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 24))))
}

/**
 * Emit an arc of the circle (cx, cy, r) running counter-clockwise from a0 to
 * a1, transformed by `m`. Under a similarity transform this stays a true
 * circular arc and becomes a single SVG `A` command; otherwise it is
 * tessellated, because a non-uniform scale turns a circle into an ellipse.
 * `continued` appends to the current subpath instead of starting a new one.
 */
function emitArc(out, bounds, m, cx, cy, r, a0, a1, continued) {
  let sweep = a1 - a0
  // DXF arcs always run counter-clockwise from start to end angle.
  while (sweep <= 0) sweep += TAU
  while (sweep > TAU) sweep -= TAU

  // Track a few points along the arc so the bounding box covers its bulge,
  // not just its endpoints.
  const probes = 8
  for (let i = 0; i <= probes; i++) {
    const a = a0 + (sweep * i) / probes
    xf(m, cx + r * Math.cos(a), cy + r * Math.sin(a))
    track(bounds, px, py)
  }

  const scale = similarityScale(m)
  xf(m, cx + r * Math.cos(a0), cy + r * Math.sin(a0))
  const sx = px
  const sy = py
  if (!continued) out.push(`M${n(sx)} ${n(sy)}`)

  if (scale !== null) {
    const rr = r * scale
    // A mirroring transform reverses the direction the arc is drawn in.
    const flag = determinant(m) < 0 ? 0 : 1
    if (sweep >= TAU - 1e-9) {
      // SVG cannot express a 360° arc in one command; split it in half.
      xf(m, cx - r * Math.cos(a0), cy - r * Math.sin(a0))
      out.push(`A${n(rr)} ${n(rr)} 0 1 ${flag} ${n(px)} ${n(py)}`)
      out.push(`A${n(rr)} ${n(rr)} 0 1 ${flag} ${n(sx)} ${n(sy)}`)
      return
    }
    const large = sweep > Math.PI ? 1 : 0
    xf(m, cx + r * Math.cos(a1), cy + r * Math.sin(a1))
    out.push(`A${n(rr)} ${n(rr)} 0 ${large} ${flag} ${n(px)} ${n(py)}`)
    return
  }

  const steps = arcSegments(sweep)
  for (let i = 1; i <= steps; i++) {
    const a = a0 + (sweep * i) / steps
    xf(m, cx + r * Math.cos(a), cy + r * Math.sin(a))
    out.push(`L${n(px)} ${n(py)}`)
  }
}

/**
 * A polyline bulge encodes a circular arc between two vertices: the bulge is
 * tan(θ/4), where θ is the included angle, signed positive for counter-clockwise.
 *
 * The centre lies on the chord's perpendicular bisector, offset by
 * (chord/2)/tan(θ/2) along the chord normal (-uy, ux). The sign of that
 * expression follows the sign of the bulge, so it puts the centre on the
 * correct side without any extra case analysis.
 */
function emitBulge(out, bounds, m, x0, y0, x1, y1, bulge) {
  const theta = 4 * Math.atan(bulge)
  const chord = Math.hypot(x1 - x0, y1 - y0)
  const half = Math.sin(theta / 2)
  if (chord < 1e-12 || Math.abs(half) < 1e-12) {
    xf(m, x1, y1)
    lineTo(out, bounds, px, py)
    return
  }
  const r = Math.abs(chord / (2 * half))
  const ux = (x1 - x0) / chord
  const uy = (y1 - y0) / chord
  const offset = chord / 2 / Math.tan(theta / 2)
  const cx = (x0 + x1) / 2 - uy * offset
  const cy = (y0 + y1) / 2 + ux * offset

  const a0 = Math.atan2(y0 - cy, x0 - cx)
  const a1 = Math.atan2(y1 - cy, x1 - cx)
  // emitArc always walks counter-clockwise, so a clockwise bulge is tessellated
  // backwards instead.
  if (bulge > 0) emitArc(out, bounds, m, cx, cy, r, a0, a1, true)
  else emitArcReversed(out, bounds, m, cx, cy, r, a0, a1)
}

/** Clockwise arc from a0 to a1, emitted as line segments (always continued). */
function emitArcReversed(out, bounds, m, cx, cy, r, a0, a1) {
  let sweep = a0 - a1
  while (sweep <= 0) sweep += TAU
  while (sweep > TAU) sweep -= TAU
  const steps = arcSegments(sweep)
  for (let i = 1; i <= steps; i++) {
    const a = a0 - (sweep * i) / steps
    xf(m, cx + r * Math.cos(a), cy + r * Math.sin(a))
    track(bounds, px, py)
    out.push(`L${n(px)} ${n(py)}`)
  }
}

/* -------------------------------------------------------------- polylines */

function emitVertices(out, bounds, m, vertices, closed) {
  let started = false
  let prev = null
  for (const v of vertices) {
    if (typeof v?.x !== 'number' || typeof v?.y !== 'number') continue
    if (!started) {
      xf(m, v.x, v.y)
      moveTo(out, bounds, px, py)
      started = true
    } else if (prev?.bulge) {
      emitBulge(out, bounds, m, prev.x, prev.y, v.x, v.y, prev.bulge)
    } else {
      xf(m, v.x, v.y)
      lineTo(out, bounds, px, py)
    }
    prev = v
  }
  if (!started) return
  if (closed) {
    const first = vertices.find((v) => typeof v?.x === 'number')
    if (prev?.bulge && first) {
      emitBulge(out, bounds, m, prev.x, prev.y, first.x, first.y, prev.bulge)
    }
    out.push('Z')
  }
}

/* ---------------------------------------------------------------- splines */

/** Evaluate a B-spline at parameter t with De Boor's algorithm. */
function deBoor(t, degree, ctrl, knots) {
  let k = degree
  while (k < knots.length - degree - 1 && t >= knots[k + 1]) k++

  const d = []
  for (let j = 0; j <= degree; j++) {
    const p = ctrl[j + k - degree]
    d.push({ x: p?.x ?? 0, y: p?.y ?? 0 })
  }
  for (let r = 1; r <= degree; r++) {
    for (let j = degree; j >= r; j--) {
      const i = j + k - degree
      const den = knots[i + degree - r + 1] - knots[i]
      const alpha = den === 0 ? 0 : (t - knots[i]) / den
      d[j] = {
        x: (1 - alpha) * d[j - 1].x + alpha * d[j].x,
        y: (1 - alpha) * d[j - 1].y + alpha * d[j].y,
      }
    }
  }
  return d[degree]
}

function emitSpline(out, bounds, m, entity) {
  const ctrl = entity.controlPoints
  const degree = entity.degreeOfSplineCurve ?? 3
  const knots = entity.knotValues

  // Without a usable knot vector, fall back to the fit points (or the control
  // polygon) — a visible approximation beats dropping the entity silently.
  const usable =
    Array.isArray(ctrl) &&
    ctrl.length > degree &&
    Array.isArray(knots) &&
    knots.length === ctrl.length + degree + 1

  if (!usable) {
    const pts = entity.fitPoints?.length ? entity.fitPoints : ctrl
    if (pts?.length) emitVertices(out, bounds, m, pts, !!entity.closed)
    return
  }

  const t0 = knots[degree]
  const t1 = knots[knots.length - degree - 1]
  const steps = Math.min(400, Math.max(16, ctrl.length * 12))
  for (let i = 0; i <= steps; i++) {
    // Nudge off the top end so the final span stays in range.
    const t = t0 + ((t1 - t0) * i) / steps - (i === steps ? 1e-9 : 0)
    const p = deBoor(t, degree, ctrl, knots)
    xf(m, p.x, p.y)
    if (i === 0) moveTo(out, bounds, px, py)
    else lineTo(out, bounds, px, py)
  }
  if (entity.closed) out.push('Z')
}

/* --------------------------------------------------------------- ellipses */

function emitEllipse(out, bounds, m, entity) {
  const c = entity.center
  const major = entity.majorAxisEndPoint
  if (!c || !major) return
  const a = Math.hypot(major.x ?? 0, major.y ?? 0)
  const b = a * (entity.axisRatio ?? 1)
  const rot = Math.atan2(major.y ?? 0, major.x ?? 0)
  const a0 = entity.startAngle ?? 0
  let a1 = entity.endAngle ?? TAU
  if (a1 <= a0) a1 += TAU
  const steps = arcSegments(a1 - a0)
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  for (let i = 0; i <= steps; i++) {
    const t = a0 + ((a1 - a0) * i) / steps
    const ex = a * Math.cos(t)
    const ey = b * Math.sin(t)
    xf(m, c.x + ex * cos - ey * sin, c.y + ex * sin + ey * cos)
    if (i === 0) moveTo(out, bounds, px, py)
    else lineTo(out, bounds, px, py)
  }
}

/* ------------------------------------------------------------------ entry */

/**
 * Append `entity` to `out` (an array of SVG path command strings) after
 * transforming it by `m`, growing `bounds` to cover it.
 * Returns false for entity types that produce no path.
 */
export function emitEntity(entity, m, out, bounds) {
  switch (entity.type) {
    case 'LINE': {
      const [p0, p1] = entity.vertices ?? []
      if (!p0 || !p1) return false
      xf(m, p0.x, p0.y)
      moveTo(out, bounds, px, py)
      xf(m, p1.x, p1.y)
      lineTo(out, bounds, px, py)
      return true
    }

    case 'LWPOLYLINE':
    case 'POLYLINE': {
      if (!entity.vertices?.length) return false
      emitVertices(out, bounds, m, entity.vertices, !!entity.shape)
      return true
    }

    case 'CIRCLE': {
      if (!entity.center || !(entity.radius > 0)) return false
      emitArc(out, bounds, m, entity.center.x, entity.center.y, entity.radius, 0, TAU, false)
      return true
    }

    case 'ARC': {
      if (!entity.center || !(entity.radius > 0)) return false
      emitArc(
        out,
        bounds,
        m,
        entity.center.x,
        entity.center.y,
        entity.radius,
        entity.startAngle ?? 0,
        entity.endAngle ?? TAU,
        false,
      )
      return true
    }

    case 'ELLIPSE':
      emitEllipse(out, bounds, m, entity)
      return true

    case 'SPLINE':
      emitSpline(out, bounds, m, entity)
      return true

    case 'SOLID':
    case '3DFACE': {
      const pts = (entity.points ?? entity.vertices ?? []).filter(Boolean)
      if (pts.length < 3) return false
      // SOLID stores its four corners in a bow-tie order (0,1,3,2).
      const order = pts.length === 4 ? [0, 1, 3, 2] : pts.map((_, i) => i)
      order.forEach((idx, i) => {
        xf(m, pts[idx].x, pts[idx].y)
        if (i === 0) moveTo(out, bounds, px, py)
        else lineTo(out, bounds, px, py)
      })
      out.push('Z')
      return true
    }

    case 'POINT': {
      const p = entity.position
      if (!p) return false
      // Zero-length subpath; rendered visible by stroke-linecap: round.
      xf(m, p.x, p.y)
      moveTo(out, bounds, px, py)
      lineTo(out, bounds, px, py)
      return true
    }

    default:
      return false
  }
}

/** World-space placement of a text-like entity, after `m`. */
export function textPlacement(entity, m) {
  const p =
    entity.position ??
    entity.startPoint ??
    entity.endPoint ??
    entity.center ?? { x: 0, y: 0 }
  const scale = similarityScale(m) ?? Math.sqrt(Math.abs(determinant(m))) ?? 1
  const height = (entity.textHeight ?? entity.height ?? 1) * (scale || 1)
  const local = ((entity.rotation ?? 0) * Math.PI) / 180
  const matrixRotation = Math.atan2(m[1], m[0])
  xf(m, p.x ?? 0, p.y ?? 0)
  return {
    x: px,
    y: py,
    size: height,
    // Degrees, measured in the Y-up world frame.
    angle: ((local + matrixRotation) * 180) / Math.PI,
  }
}
