/**
 * Smoke test for the DXF pipeline, runnable without a browser.
 *
 * Parses a drawing, bakes it to plan geometry, runs sign detection, and
 * asserts the results against what the fixture is known to contain. Run with
 * `npm test`, or point it at a real drawing to see how it would be imported:
 *
 *   node scripts/check-import.mjs path/to/plan.dxf
 */

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseDxf, looksLikeDxf } from '../src/dxf/parse.js'
import { buildPlan } from '../src/dxf/flatten.js'
import {
  analyseInserts,
  bestStrategy,
  makeSigns,
  selectedInserts,
  strategyLabel,
  suggestSelection,
} from '../src/dxf/detectSigns.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2] ?? join(root, 'fixtures', 'sample-plan.dxf')
const isFixture = !process.argv[2]

const text = readFileSync(target, 'utf8')
if (!looksLikeDxf(text)) {
  console.error(`${target} does not look like an ASCII DXF file.`)
  process.exit(1)
}

const started = Date.now()
const plan = buildPlan(parseDxf(text), { fileName: target.split('/').pop() })
const elapsed = Date.now() - started

const analysis = analyseInserts(plan.inserts)
const selection = suggestSelection(analysis)
const chosen = selectedInserts(plan.inserts, selection)
const strategy = bestStrategy(chosen)
const signs = makeSigns(plan.inserts, selection, strategy)

console.log(`\n${target}`)
console.log(`  parsed in            ${elapsed} ms`)
console.log(`  entities             ${plan.stats.entities}`)
console.log(`  layers               ${plan.layers.map((l) => l.name).join(', ')}`)
console.log(`  baked paths          ${plan.paths.length}`)
console.log(`  path data            ${plan.paths.reduce((n, p) => n + p.d.length, 0)} chars`)
console.log(`  text labels          ${plan.labels.length}`)
console.log(
  `  bounds               ${plan.bounds.minX.toFixed(1)}, ${plan.bounds.minY.toFixed(1)} → ` +
    `${plan.bounds.maxX.toFixed(1)}, ${plan.bounds.maxY.toFixed(1)}`,
)
const skipped = Object.entries(plan.stats.unsupported)
console.log(`  skipped entities     ${skipped.length ? skipped.map(([t, n]) => `${n}× ${t}`).join(', ') : 'none'}`)

console.log('\n  blocks:')
for (const block of analysis) {
  const tags = block.tags.length ? ` attrs=[${block.tags.map((t) => t.tag).join(',')}]` : ''
  const picked = selection.includes(block.name) ? ' <- selected' : ''
  console.log(`    ${block.name.padEnd(16)} ${String(block.count).padStart(4)}${tags}${picked}`)
}

console.log(`\n  naming strategy      ${strategyLabel(strategy)}`)
console.log(`  signs detected       ${signs.length}`)
const byType = {}
for (const sign of signs) byType[sign.type] = (byType[sign.type] ?? 0) + 1
console.log(`  types                ${Object.entries(byType).map(([t, n]) => `${t}(${n})`).join(' ')}`)
console.log(`  sample               ${signs.slice(0, 6).map((s) => s.name).join(', ')}`)

if (!isFixture) process.exit(0)

/* ------------------------------------------------------- fixture assertions */

const failures = []
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

check('all five layers present', plan.layers.length === 5, `got ${plan.layers.length}`)
check('geometry was baked', plan.paths.length > 0)
// Four room labels, and no ATTDEF placeholders leaking in from the SIGN block.
check('room labels imported', plan.labels.length === 4, `got ${plan.labels.length}`)
check('no ATTDEF placeholder text', !plan.labels.some((l) => l.text === 'SIGN_NAME'))
check('nothing was skipped', Object.keys(plan.stats.unsupported).length === 0)
check(
  'bounds cover the 40x22 building',
  plan.bounds.minX <= 0 && plan.bounds.maxX >= 40 && plan.bounds.maxY >= 22,
  JSON.stringify(plan.bounds),
)

check('DOOR was not treated as signage', !selection.includes('DOOR'))
check('SIGN was selected', selection.includes('SIGN'))
check('names come from the NAME attribute', strategy.kind === 'attrib' && strategy.tag === 'NAME')
// Ten top-level SIGN references plus one SIGN_ASSEMBLY. The SIGN nested inside
// the assembly must NOT become a twelfth sign — it is the same physical sign.
check('eleven signs detected, no nested double-count', signs.length === 11, `got ${signs.length}`)
check(
  'types split into WF / DIR / ID / REG',
  ['WF', 'DIR', 'ID', 'REG'].every((t) => byType[t] > 0),
  JSON.stringify(byType),
)
check('WF_01 is where it was placed', signs.some((s) => s.name === 'WF_01' && Math.abs(s.x - 3) < 0.001 && Math.abs(s.y - 19) < 0.001))
check(
  'rotated sign kept its rotation',
  Math.abs((signs.find((s) => s.name === 'WF_03')?.rotation ?? 0) - 90) < 0.001,
)
check('every sign starts unchecked', signs.every((s) => s.status === 'unchecked'))
check('nested block geometry rendered', plan.inserts.some((i) => i.blockName === 'SIGN_ASSEMBLY'))

// SIGN_ASSEMBLY sits at (36, 20) rotated 45°, and holds a SIGN offset by
// (0, 0.3) within the assembly. Where that nested reference lands is the proof
// that transforms compose correctly through nesting. The inner reference's own
// 0.8 scale applies to the SIGN block's contents, not to its placement inside
// the assembly, so it does not enter this calculation.
const nested = plan.inserts.find(
  (i) => i.blockName === 'SIGN' && i.parents?.includes('SIGN_ASSEMBLY'),
)
const theta = Math.PI / 4
const expectedX = 36 - 0.3 * Math.sin(theta)
const expectedY = 20 + 0.3 * Math.cos(theta)
check(
  'nested block reference lands in the right place',
  nested && Math.abs(nested.x - expectedX) < 0.01 && Math.abs(nested.y - expectedY) < 0.01,
  nested
    ? `${nested.x.toFixed(3)}, ${nested.y.toFixed(3)} vs ${expectedX.toFixed(3)}, ${expectedY.toFixed(3)}`
    : 'not found',
)
check(
  'nested reference records its parent chain',
  nested?.parents?.length === 1 && nested.parents[0] === 'SIGN_ASSEMBLY',
)

// The bulged corner must have produced a real arc command, not a straight line.
check(
  'bulged polyline corner became an arc',
  plan.paths.some((p) => p.layer === 'WALLS' && p.d.includes('A')),
)

if (failures.length) {
  console.error(`\n✗ ${failures.length} check(s) failed:`)
  for (const failure of failures) console.error(`    ${failure}`)
  process.exit(1)
}

console.log(`\n✓ all checks passed\n`)
