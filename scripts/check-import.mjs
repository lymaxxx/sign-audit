/**
 * Smoke test for the DXF pipeline, runnable without a browser.
 *
 * Parses a drawing, bakes it to plan geometry, runs sign detection, and asserts
 * the results. Run with `npm test`, or point it at any drawing to see exactly
 * how it would be imported before opening the app:
 *
 *   node scripts/check-import.mjs path/to/plan.dxf
 */

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseDxf, looksLikeDxf } from '../src/dxf/parse.js'
import { auditDxf, reconcile } from '../src/dxf/audit.js'
import { buildPlan } from '../src/dxf/flatten.js'
import { analyseDrawing, buildSigns, suggestRecipe } from '../src/dxf/detectSigns.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2] ?? join(root, 'fixtures', 'sample-plan.dxf')
const isFixture = !process.argv[2]

const text = readFileSync(target, 'utf8')
if (!looksLikeDxf(text)) {
  console.error(`${target} does not look like an ASCII DXF file.`)
  process.exit(1)
}

const census = auditDxf(text)
const started = Date.now()
const dxf = parseDxf(text, census)
const plan = buildPlan(dxf, { fileName: target.split('/').pop() })
const elapsed = Date.now() - started

const ledger = reconcile(census, plan.stats.rendered, plan.stats.skipped)
const analysis = analyseDrawing(dxf, plan)
const recipe = suggestRecipe(analysis)
const { signs, links, unlinked } = buildSigns(analysis, recipe)

console.log(`\n${target}`)
console.log(`  parsed in            ${elapsed} ms`)
console.log(`  entities             ${plan.stats.entities}`)
console.log(`  layers               ${plan.layers.map((l) => l.name).join(', ')}`)
console.log(
  `  baked paths          ${plan.paths.length} (${plan.paths.filter((p) => p.filled).length} filled)`,
)
console.log(`  text labels          ${plan.labels.length}`)
console.log(
  `  bounds               ${plan.bounds.minX.toFixed(1)}, ${plan.bounds.minY.toFixed(1)} → ` +
    `${plan.bounds.maxX.toFixed(1)}, ${plan.bounds.maxY.toFixed(1)}`,
)

console.log('\n  entity support (occurrences in file / of those, in model space):')
for (const row of ledger) {
  const mark = row.status === 'ok' ? '  ok   ' : row.status === 'skipped' ? '  skip ' : '  LOST '
  console.log(
    `  ${mark} ${row.type.padEnd(13)} ${String(row.found).padStart(5)} in file, ${String(row.inModelSpace).padStart(4)} in model space`,
  )
}

console.log('\n  blocks:')
for (const block of analysis.blocks) {
  const role = recipe.markerBlocks.has(block.name)
    ? ' <- marker'
    : recipe.tagBlocks.has(block.name)
      ? ' <- data'
      : ''
  const variants = block.variants.length ? ` +${block.variants.length} variants` : ''
  const tags = block.tags.length ? ` attrs=[${block.tags.join(',')}]` : ''
  console.log(
    `    ${block.name.padEnd(22)} ${String(block.count).padStart(3)}  scale≈${block.medianScale.toFixed(0).padStart(4)}${block.rotated ? ' rot' : '    '}${tags}${variants}${role}`,
  )
}

console.log(
  `\n  loose-marker layers  ${analysis.looseLayers.map((l) => `${l.layer}(${l.withCentreMark}/${l.circles})`).join(', ') || 'none'}`,
)
console.log(`  leaders found        ${analysis.leaders.length}`)
console.log(`  name attribute       ${recipe.nameTag ?? '(none)'}`)
console.log(
  `  signs detected       ${signs.length}  (${links.length} linked, ${unlinked} without a callout)`,
)

console.log('\n  signs:')
for (const sign of signs) {
  const sides = sign.sides.map((s) => `${s.id}@${Math.round(s.bearing)}°`).join(' ')
  console.log(
    `    ${sign.name.padEnd(14)} ${sign.type.padEnd(24)} ${sign.source.padEnd(6)} ${sign.status.padEnd(9)} sides=[${sides}]`,
  )
}

if (!isFixture) process.exit(0)

/* ------------------------------------------------------- fixture assertions */

const failures = []
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

check('all eight layers present', plan.layers.length === 8, `got ${plan.layers.length}`)
// Sign type is the layer name now, so the fixture models the real convention:
// one layer per sign family.
const byType = {}
for (const sign of signs) byType[sign.type] = (byType[sign.type] ?? 0) + 1
check(
  'types split by sign layer',
  ['_WAYFINDING_SIGN', '_DIRECTIONAL_SIGN', '_IDENTIFICATION_SIGN', '_REGULATORY_SIGN'].every(
    (t) => byType[t] > 0,
  ),
  JSON.stringify(byType),
)
// Ten named block markers + SIGN_ASSEMBLY (self-describing, unlinked) + the
// loose circle marker linked through its leader to TAG_HEAD.
check('twelve signs, no nested double-count', signs.length === 12, `got ${signs.length}`)
check(
  'loose circle marker linked through its leader',
  signs.find((s) => s.source === 'loose')?.name === 'LOOSE_01',
  JSON.stringify(signs.find((s) => s.source === 'loose')),
)
check(
  'every named sign starts unchecked',
  signs.filter((s) => s.name.startsWith('WF_')).every((s) => s.status === 'unchecked'),
)
check(
  'a marker with no callout is flagged for review',
  signs.find((s) => s.name === 'SIGN_ASSEMBLY')?.status === 'review',
)
check(
  'rotation seeds the first side bearing',
  Math.abs((signs.find((s) => s.name === 'WF_03')?.sides[0]?.bearing ?? 0) - 90) < 0.001,
  JSON.stringify(signs.find((s) => s.name === 'WF_03')?.sides),
)
check('geometry was baked', plan.paths.length > 0)
check('room labels imported', plan.labels.length === 4, `got ${plan.labels.length}`)
check('no ATTDEF placeholder text', !plan.labels.some((l) => l.text === 'SIGN_NAME'))
check(
  'every entity type is supported',
  !ledger.some((r) => r.status === 'lost'),
  ledger
    .filter((r) => r.status === 'lost')
    .map((r) => r.type)
    .join(', '),
)
check(
  'bounds cover the 40x22 building',
  plan.bounds.minX <= 0 && plan.bounds.maxX >= 40 && plan.bounds.maxY >= 22,
  JSON.stringify(plan.bounds),
)

check(
  'SIGN chosen as the marker block',
  recipe.markerBlocks.has('SIGN'),
  [...recipe.markerBlocks].join(','),
)
check('DOOR was not treated as signage', !recipe.markerBlocks.has('DOOR'))
check(
  'bulged polyline corner became an arc',
  plan.paths.some((p) => p.layer === 'WALLS' && p.d.includes('A')),
)

// Nested references must not double-count: the SIGN inside SIGN_ASSEMBLY is the
// same physical sign as the assembly.
const nested = plan.inserts.find(
  (i) => i.blockName === 'SIGN' && i.parents?.includes('SIGN_ASSEMBLY'),
)
const theta = Math.PI / 4
check(
  'nested block reference lands in the right place',
  nested &&
    Math.abs(nested.x - (36 - 0.3 * Math.sin(theta))) < 0.01 &&
    Math.abs(nested.y - (20 + 0.3 * Math.cos(theta))) < 0.01,
  nested ? `${nested.x.toFixed(3)}, ${nested.y.toFixed(3)}` : 'not found',
)

check('every sign has at least one side', signs.every((s) => s.sides.length >= 1))

/* ---------------------------------------------------- malformed input cases */

// Real drawings arrive damaged. Each of these used to lose the entire file:
// one bad entity, or a transfer cut short, and nothing at all would open.
const lines = text.split('\n')

const withEmptyPolyline = (() => {
  const out = []
  let done = false
  for (let i = 0; i + 1 < lines.length; i += 2) {
    if (!done && lines[i].trim() === '0' && lines[i + 1].trim() === 'ENDSEC') {
      out.push('  0', 'LWPOLYLINE', '  8', 'WALLS', ' 90', '0', ' 70', '0')
      done = true
    }
    out.push(lines[i], lines[i + 1])
  }
  return out.join('\n')
})()

try {
  const repaired = buildPlan(parseDxf(withEmptyPolyline), {})
  check(
    'a zero-vertex polyline does not lose the drawing',
    repaired.stats.entities >= plan.stats.entities,
    `${repaired.stats.entities} vs ${plan.stats.entities} entities`,
  )
} catch (error) {
  check('a zero-vertex polyline does not lose the drawing', false, error.message)
}

// Cut mid-pair, so the dangling group code has to be dropped before the file
// can be closed off and re-read.
const truncated = lines.slice(0, Math.floor(lines.length / 2)).join('\n')
try {
  const salvaged = buildPlan(parseDxf(truncated), {})
  check(
    'a truncated file still imports what it can',
    salvaged.stats.entities > 0,
    `${salvaged.stats.entities} entities recovered`,
  )
} catch (error) {
  check('a truncated file still imports what it can', false, error.message)
}

// A valid file with no drawing in it is not an error — it imports as an empty
// plan. What matters is that it does not throw a group-code message at anyone.
try {
  const empty = buildPlan(parseDxf('0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n'), {})
  check('an empty drawing imports as an empty plan', empty.stats.entities === 0 && empty.paths.length === 0)
} catch (error) {
  check('an empty drawing imports as an empty plan', false, error.message)
}


if (failures.length) {
  console.error(`\n✗ ${failures.length} check(s) failed:`)
  for (const failure of failures) console.error(`    ${failure}`)
  process.exit(1)
}

console.log('\n✓ all checks passed\n')
