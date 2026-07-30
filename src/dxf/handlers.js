/**
 * Extra entity handlers registered into `dxf-parser`.
 *
 * The library ships handlers for about fifteen entity types and silently drops
 * everything else — on a real signage drawing that meant losing 67 HATCH and
 * 4 WIPEOUT entities, which are the filled sign symbols and callout tables, the
 * most recognisable things on the plan. It also *throws* on a couple of
 * perfectly common shapes, and a throw anywhere aborts the whole file.
 *
 * `registerEntityHandler()` is public API, so each gap is filled here rather
 * than by patching the dependency.
 */

/**
 * Read every group up to (not including) the next 0-code, as raw {code, value}.
 *
 * Entities with counted, nested structures — HATCH boundary loops above all —
 * are far easier to read from a flat list than from the streaming switch the
 * built-in handlers use. Leaves the scanner on the 0-code, which is the
 * contract `parseEntities` expects.
 */
function collectGroups(scanner) {
  const groups = []
  let curr = scanner.next()
  while (curr.code !== 0) {
    groups.push({ code: curr.code, value: curr.value })
    // A file truncated mid-entity would make next() throw, taking the whole
    // document with it. Stop cleanly instead and keep what we have.
    if (scanner.isEOF() || !scanner.hasNext()) break
    curr = scanner.next()
  }
  return groups
}

/** Copy the codes every entity shares onto the parsed entity. */
function applyCommon(entity, groups) {
  for (const { code, value } of groups) {
    switch (code) {
      case 5:
        entity.handle = value
        break
      case 6:
        entity.lineType = value
        break
      case 8:
        entity.layer = value
        break
      case 60:
        entity.visible = value === 0
        break
      case 62:
        entity.colorIndex = value
        break
      case 67:
        entity.inPaperSpace = value !== 0
        break
      case 420:
        entity.color = value
        break
      case 330:
        entity.ownerHandle = value
        break
      default:
        break
    }
  }
  return entity
}

/** Sequential reader over the flat group list. */
class Cursor {
  constructor(groups) {
    this.groups = groups
    this.i = 0
  }

  get done() {
    return this.i >= this.groups.length
  }

  peek() {
    return this.groups[this.i]
  }

  next() {
    return this.groups[this.i++]
  }

  /** Advance to the next group with this code and consume it, else null. */
  seek(code) {
    while (!this.done) {
      const g = this.next()
      if (g.code === code) return g
    }
    return null
  }

  /** Consume the next group if it has this code, else return null. */
  take(code) {
    if (!this.done && this.peek().code === code) return this.next()
    return null
  }
}

/* ------------------------------------------------------------------- HATCH */

const PATH_IS_POLYLINE = 2

/**
 * Boundary loops of a HATCH.
 *
 * Two shapes exist and both appear in the same drawing:
 *   - polyline loop: 92 flags (bit 2 set), 72 has-bulge, 73 closed,
 *     93 vertex count, then that many 10/20 (+42 bulge)
 *   - edge list:     92 flags, 93 edge count, then per edge a 72 edge type
 *     followed by that edge's own codes (line, arc, ellipse or spline)
 *
 * Counts must be honoured exactly: a HATCH carries further 10/20 pairs after
 * the loops (seed points), and reading greedily swallows them into the shape.
 */
function parseHatchLoops(cursor, loopCount) {
  const loops = []

  for (let n = 0; n < loopCount && !cursor.done; n++) {
    const flags = cursor.seek(92)
    if (!flags) break

    if (flags.value & PATH_IS_POLYLINE) {
      const hasBulge = cursor.take(72)?.value
      const closed = cursor.take(73)?.value
      const count = cursor.take(93)?.value ?? 0
      const vertices = []
      for (let v = 0; v < count; v++) {
        const x = cursor.take(10)
        const y = cursor.take(20)
        if (!x || !y) break
        const vertex = { x: x.value, y: y.value }
        if (hasBulge) {
          const bulge = cursor.take(42)
          if (bulge?.value) vertex.bulge = bulge.value
        }
        vertices.push(vertex)
      }
      if (vertices.length) loops.push({ closed: !!closed, vertices })
      continue
    }

    const edgeCount = cursor.take(93)?.value ?? 0
    const edges = []
    for (let e = 0; e < edgeCount; e++) {
      const type = cursor.take(72)?.value
      if (type == null) break
      if (type === 1) {
        const x1 = cursor.take(10)?.value
        const y1 = cursor.take(20)?.value
        const x2 = cursor.take(11)?.value
        const y2 = cursor.take(21)?.value
        edges.push({ type: 'line', x1, y1, x2, y2 })
      } else if (type === 2) {
        edges.push({
          type: 'arc',
          x: cursor.take(10)?.value,
          y: cursor.take(20)?.value,
          radius: cursor.take(40)?.value,
          startAngle: cursor.take(50)?.value,
          endAngle: cursor.take(51)?.value,
          counterclockwise: cursor.take(73)?.value !== 0,
        })
      } else if (type === 3) {
        edges.push({
          type: 'ellipse',
          x: cursor.take(10)?.value,
          y: cursor.take(20)?.value,
          majorX: cursor.take(11)?.value,
          majorY: cursor.take(21)?.value,
          ratio: cursor.take(40)?.value,
          startAngle: cursor.take(50)?.value,
          endAngle: cursor.take(51)?.value,
          counterclockwise: cursor.take(73)?.value !== 0,
        })
      } else if (type === 4) {
        // Spline edge. The control polygon is a good enough outline here, and
        // it avoids a second spline evaluator.
        cursor.take(94)
        cursor.take(73)
        cursor.take(74)
        const knots = cursor.take(95)?.value ?? 0
        const controls = cursor.take(96)?.value ?? 0
        for (let k = 0; k < knots; k++) cursor.take(40)
        const vertices = []
        for (let c = 0; c < controls; c++) {
          const x = cursor.take(10)
          const y = cursor.take(20)
          if (!x || !y) break
          cursor.take(42)
          vertices.push({ x: x.value, y: y.value })
        }
        if (vertices.length) edges.push({ type: 'polyline', vertices })
      } else {
        break
      }
    }
    if (edges.length) loops.push({ closed: true, edges })
  }

  return loops
}

export class HatchHandler {
  constructor() {
    this.ForEntityName = 'HATCH'
  }

  parseEntity(scanner, curr) {
    const groups = collectGroups(scanner)
    const entity = applyCommon({ type: curr.value, loops: [] }, groups)

    const cursor = new Cursor(groups)
    for (const g of groups) {
      if (g.code === 2) entity.patternName = g.value
      // 70 = 1 means a solid fill rather than a line pattern.
      else if (g.code === 70) entity.solid = g.value === 1
    }
    const count = cursor.seek(91)
    if (count) entity.loops = parseHatchLoops(cursor, count.value)
    return entity
  }
}

/* ----------------------------------------------------------------- WIPEOUT */

/**
 * A masking rectangle. Its boundary is parsed so it can be counted and
 * reported, but it is never drawn: a WIPEOUT hides what is beneath it, and
 * rendering it as a filled shape would black out part of the plan.
 */
export class WipeoutHandler {
  constructor() {
    this.ForEntityName = 'WIPEOUT'
  }

  parseEntity(scanner, curr) {
    const groups = collectGroups(scanner)
    return applyCommon({ type: curr.value, masks: true }, groups)
  }
}

/* -------------------------------------------------------------- LWPOLYLINE */

/**
 * Tolerant replacement for the built-in handler, which throws
 * ('n must be greater than 0 verticies') on a zero-vertex polyline and takes
 * the entire drawing down with it. Degenerate polylines are common in files
 * that have been through several rounds of editing.
 */
export class LwPolylineHandler {
  constructor() {
    this.ForEntityName = 'LWPOLYLINE'
  }

  parseEntity(scanner, curr) {
    const groups = collectGroups(scanner)
    const entity = applyCommon({ type: curr.value, vertices: [] }, groups)

    let vertex = null
    for (const { code, value } of groups) {
      switch (code) {
        case 70:
          entity.shape = (value & 1) === 1
          break
        case 38:
          entity.elevation = value
          break
        case 43:
          if (value !== 0) entity.width = value
          break
        case 10:
          if (vertex) entity.vertices.push(vertex)
          vertex = { x: value, y: 0 }
          break
        case 20:
          if (vertex) vertex.y = value
          break
        case 42:
          if (vertex && value !== 0) vertex.bulge = value
          break
        default:
          break
      }
    }
    if (vertex) entity.vertices.push(vertex)
    return entity
  }
}

/* ------------------------------------------------------- LEADER / MLEADER */

/** Plain LEADER: a vertex list, which is all the plan needs from it. */
export class LeaderHandler {
  constructor() {
    this.ForEntityName = 'LEADER'
  }

  parseEntity(scanner, curr) {
    const groups = collectGroups(scanner)
    const entity = applyCommon({ type: curr.value, vertices: [] }, groups)
    let vertex = null
    for (const { code, value } of groups) {
      if (code === 10) {
        if (vertex) entity.vertices.push(vertex)
        vertex = { x: value, y: 0 }
      } else if (code === 20 && vertex) {
        vertex.y = value
      }
    }
    if (vertex) entity.vertices.push(vertex)
    return entity
  }
}

/**
 * MULTILEADER. Its geometry lives in a deeply nested context block; codes
 * 10/11 inside that block are the leader line points, which is enough to draw
 * the line and to use it as a link between a sign and its callout.
 */
export class MLeaderHandler {
  constructor() {
    this.ForEntityName = 'MULTILEADER'
  }

  parseEntity(scanner, curr) {
    const groups = collectGroups(scanner)
    const entity = applyCommon({ type: curr.value, vertices: [] }, groups)
    let vertex = null
    for (const { code, value } of groups) {
      if (code === 10 || code === 11) {
        if (vertex) entity.vertices.push(vertex)
        vertex = { x: value, y: 0 }
      } else if ((code === 20 || code === 21) && vertex) {
        vertex.y = value
      }
    }
    if (vertex) entity.vertices.push(vertex)
    return entity
  }
}

/* ------------------------------------------------------- ATTRIB / SEQEND */

/**
 * Attribute *values* on a block reference. The library handles ATTDEF (the
 * placeholder inside a block definition) but not ATTRIB, and ATTRIB is where a
 * sign's code, level and sequential number actually live.
 */
export class AttribHandler {
  constructor() {
    this.ForEntityName = 'ATTRIB'
  }

  parseEntity(scanner, curr) {
    const groups = collectGroups(scanner)
    const entity = applyCommon({ type: curr.value }, groups)
    for (const { code, value } of groups) {
      switch (code) {
        case 1:
          entity.text = value
          break
        case 2:
          entity.tag = value
          break
        case 10:
          entity.x = value
          break
        case 20:
          entity.y = value
          break
        case 40:
          entity.textHeight = value
          break
        case 50:
          entity.rotation = value
          break
        case 70:
          entity.invisible = (value & 0x01) !== 0
          break
        default:
          break
      }
    }
    return entity
  }
}

/** SEQEND carries nothing we need; handling it keeps it out of the warnings. */
export class SeqEndHandler {
  constructor() {
    this.ForEntityName = 'SEQEND'
  }

  parseEntity(scanner, curr) {
    const groups = collectGroups(scanner)
    return applyCommon({ type: curr.value }, groups)
  }
}

/** Every handler this app adds, in registration order. */
export const EXTRA_HANDLERS = [
  HatchHandler,
  WipeoutHandler,
  LwPolylineHandler,
  LeaderHandler,
  MLeaderHandler,
  AttribHandler,
  SeqEndHandler,
]
