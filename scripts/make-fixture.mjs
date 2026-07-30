/**
 * Writes fixtures/sample-plan.dxf — a small synthetic floor plan used to
 * exercise the importer end to end without a real drawing.
 *
 * It deliberately covers the awkward parts: a closed polyline with a bulged
 * (arc) segment, arcs and circles, a spline, block references carrying their
 * names as ATTRIB values, a nested block, and a non-sign block that the import
 * wizard should leave unselected.
 *
 * Run with `node scripts/make-fixture.mjs`.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const out = []
const g = (code, value) => {
  out.push(String(code))
  out.push(String(value))
}

const section = (name, body) => {
  g(0, 'SECTION')
  g(2, name)
  body()
  g(0, 'ENDSEC')
}

/* ------------------------------------------------------------------ header */

section('HEADER', () => {
  g(9, '$ACADVER')
  g(1, 'AC1009')
  g(9, '$INSUNITS')
  g(70, 6) // metres
})

/* ------------------------------------------------------------------ tables */

// Sign type comes from the layer, mirroring how a real signage package is
// drawn: one layer per family, with a leading underscore so they sort together.
const LAYERS = [
  ['WALLS', 7], // white
  ['SERVICES', 4], // cyan
  ['TEXT', 3], // green
  ['DOORS', 8], // grey
  ['_WAYFINDING_SIGN', 2],
  ['_DIRECTIONAL_SIGN', 5],
  ['_IDENTIFICATION_SIGN', 6],
  ['_REGULATORY_SIGN', 1],
]

section('TABLES', () => {
  g(0, 'TABLE')
  g(2, 'LAYER')
  g(70, LAYERS.length)
  for (const [name, color] of LAYERS) {
    g(0, 'LAYER')
    g(2, name)
    g(70, 0)
    g(62, color)
    g(6, 'CONTINUOUS')
  }
  g(0, 'ENDTAB')
})

/* ------------------------------------------------------------------ blocks */

const block = (name, body) => {
  g(0, 'BLOCK')
  g(8, '0')
  g(2, name)
  g(70, 2) // has attribute definitions
  g(10, 0)
  g(20, 0)
  g(30, 0)
  g(3, name)
  g(1, '')
  body()
  g(0, 'ENDBLK')
  g(8, '0')
}

const line = (layer, x1, y1, x2, y2) => {
  g(0, 'LINE')
  g(8, layer)
  g(10, x1)
  g(20, y1)
  g(30, 0)
  g(11, x2)
  g(21, y2)
  g(31, 0)
}

const circle = (layer, x, y, r) => {
  g(0, 'CIRCLE')
  g(8, layer)
  g(10, x)
  g(20, y)
  g(30, 0)
  g(40, r)
}

const arc = (layer, x, y, r, start, end) => {
  g(0, 'ARC')
  g(8, layer)
  g(10, x)
  g(20, y)
  g(30, 0)
  g(40, r)
  g(50, start)
  g(51, end)
}

/** vertices: [x, y] or [x, y, bulge] */
const lwpolyline = (layer, vertices, closed) => {
  g(0, 'LWPOLYLINE')
  g(8, layer)
  g(90, vertices.length)
  g(70, closed ? 1 : 0)
  for (const [x, y, bulge] of vertices) {
    g(10, x)
    g(20, y)
    if (bulge) g(42, bulge)
  }
}

const text = (layer, x, y, height, value) => {
  g(0, 'TEXT')
  g(8, layer)
  g(10, x)
  g(20, y)
  g(30, 0)
  g(40, height)
  g(1, value)
}

section('BLOCKS', () => {
  // The sign symbol: a plate on a post, with its name held in an attribute.
  block('SIGN', () => {
    lwpolyline('0', [
      [-0.5, 0.2],
      [0.5, 0.2],
      [0.5, 0.9],
      [-0.5, 0.9],
    ], true)
    line('0', 0, 0, 0, 0.2)
    g(0, 'ATTDEF')
    g(8, '0')
    g(10, 0)
    g(20, 1.1)
    g(30, 0)
    g(40, 0.25)
    g(1, 'SIGN_NAME')
    g(3, 'Sign name')
    g(2, 'NAME')
    g(70, 0)
  })

  // A non-sign block, so the import wizard has something to leave unticked.
  block('DOOR', () => {
    line('0', 0, 0, 0.9, 0)
    arc('0', 0, 0, 0.9, 0, 90)
  })

  // A nested block: a sign symbol placed inside another block, to prove the
  // importer composes transforms through more than one level.
  block('SIGN_ASSEMBLY', () => {
    line('0', -0.6, 0, 0.6, 0)
    g(0, 'INSERT')
    g(8, '0')
    g(2, 'SIGN')
    g(10, 0)
    g(20, 0.3)
    g(30, 0)
    g(41, 0.8)
    g(42, 0.8)
    g(43, 1)
    g(50, 0)
  })
})

/* ---------------------------------------------------------------- entities */

const SIGN_LAYERS = {
  WF: '_WAYFINDING_SIGN',
  DIR: '_DIRECTIONAL_SIGN',
  ID: '_IDENTIFICATION_SIGN',
  REG: '_REGULATORY_SIGN',
}

const insertSign = (x, y, rotation, name) => {
  const layer = SIGN_LAYERS[name.split('_')[0]] ?? '_WAYFINDING_SIGN'
  g(0, 'INSERT')
  g(66, 1) // attributes follow
  g(8, layer)
  g(2, 'SIGN')
  g(10, x)
  g(20, y)
  g(30, 0)
  g(41, 1)
  g(42, 1)
  g(43, 1)
  g(50, rotation)

  g(0, 'ATTRIB')
  g(8, layer)
  g(10, x)
  g(20, y + 1.1)
  g(30, 0)
  g(40, 0.25)
  g(1, name)
  g(2, 'NAME')
  g(70, 0)

  g(0, 'SEQEND')
  g(8, layer)
}

section('ENTITIES', () => {
  // Outer wall, with one rounded corner to exercise bulge handling.
  lwpolyline(
    'WALLS',
    [
      [0, 0],
      [40, 0],
      [40, 18, 0.4142], // 90-degree arc segment
      [36, 22],
      [0, 22],
    ],
    true,
  )

  // Internal walls.
  line('WALLS', 12, 0, 12, 14)
  line('WALLS', 12, 14, 26, 14)
  line('WALLS', 26, 14, 26, 0)
  line('WALLS', 0, 18, 12, 18)
  line('WALLS', 26, 8, 40, 8)

  // Structure and services.
  for (const x of [8, 20, 32]) circle('SERVICES', x, 11, 0.35)
  arc('SERVICES', 33, 18, 3, 180, 270)

  // A spline, to prove curved detailing survives import.
  g(0, 'SPLINE')
  g(8, 'SERVICES')
  g(70, 8) // planar
  g(71, 3) // degree
  g(72, 8) // knots
  g(73, 4) // control points
  for (const knot of [0, 0, 0, 0, 1, 1, 1, 1]) g(40, knot)
  for (const [x, y] of [
    [2, 20],
    [5, 15],
    [9, 21],
    [11, 16],
  ]) {
    g(10, x)
    g(20, y)
    g(30, 0)
  }

  // Room labels.
  text('TEXT', 4, 10, 0.6, 'RECEPTION')
  text('TEXT', 16, 6, 0.6, 'CORE')
  text('TEXT', 30, 16, 0.6, 'RETAIL 01')
  text('TEXT', 30, 4, 0.6, 'BACK OF HOUSE')

  // Doors — a block that is not signage.
  for (const [x, y] of [
    [12, 4],
    [26, 4],
    [12, 16],
  ]) {
    g(0, 'INSERT')
    g(8, 'DOORS')
    g(2, 'DOOR')
    g(10, x)
    g(20, y)
    g(30, 0)
    g(50, 0)
  }

  // Signage: three types, so the type filter has something to separate.
  insertSign(3, 19, 0, 'WF_01')
  insertSign(11, 2, 0, 'WF_02')
  insertSign(25, 12, 90, 'WF_03')
  insertSign(38, 6, 180, 'WF_04')
  insertSign(6, 4, 0, 'DIR_01')
  insertSign(18, 13, 0, 'DIR_02')
  insertSign(34, 10, 270, 'DIR_03')
  insertSign(2, 12, 0, 'ID_01')
  insertSign(30, 20, 0, 'ID_02')
  insertSign(20, 2, 0, 'REG_01')

  // The nested assembly, without attributes: names for these come from the
  // block name unless the user picks another source.
  g(0, 'INSERT')
  g(8, '_WAYFINDING_SIGN')
  g(2, 'SIGN_ASSEMBLY')
  g(10, 36)
  g(20, 20)
  g(30, 0)
  g(50, 45)
})

g(0, 'EOF')

mkdirSync(join(root, 'fixtures'), { recursive: true })
const file = join(root, 'fixtures', 'sample-plan.dxf')
writeFileSync(file, `${out.join('\n')}\n`, 'utf8')
console.log(`wrote fixtures/sample-plan.dxf (${out.length / 2} groups)`)
