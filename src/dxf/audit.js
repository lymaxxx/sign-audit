/**
 * Raw group-code census of a DXF file, taken before it is parsed.
 *
 * The importer used to report "skipped entities: none" while quietly losing 71
 * filled shapes, because entity types the library has no handler for are
 * discarded inside it and never reach the app's tally. Counting straight from
 * the file is the only way to know what was really in there, so the wizard can
 * say "67 HATCH found, 67 rendered" — or admit it dropped something.
 */

// Values of a 0-code that describe file structure rather than drawn content.
const STRUCTURAL = new Set([
  'SECTION',
  'ENDSEC',
  'EOF',
  'TABLE',
  'ENDTAB',
  'BLOCK',
  'ENDBLK',
  'CLASS',
  'SEQEND',
])

// Entity types that exist only to carry data or annotation, so their absence
// from the drawing is not a loss worth reporting.
const NOT_DRAWN = new Set(['ATTRIB', 'ATTDEF', 'VIEWPORT'])

/**
 * @param {string} text raw DXF contents
 * @returns {{
 *   entities: Record<string, number>,
 *   bySection: Record<string, Record<string, number>>,
 *   layers: string[],
 *   groups: number,
 *   truncated: boolean,
 * }}
 */
export function auditDxf(text) {
  const lines = text.split(/\r\n|\r|\n/)
  const entities = {}
  const bySection = {}
  const layers = new Set()
  // Per-layer entity counts, split by where they were found. An entity inside
  // a BLOCKS definition is only ever drawn if something inserts that block, so
  // the two have to be told apart to explain a layer that renders nothing.
  const layerCounts = new Map()

  let section = null
  let pendingSectionName = false
  let sawEof = false
  let lastZeroValue = null

  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i].trim()
    const value = lines[i + 1].trim()

    if (code === '0') {
      lastZeroValue = value
      if (value === 'SECTION') {
        pendingSectionName = true
      } else if (value === 'ENDSEC') {
        section = null
      } else if (value === 'EOF') {
        sawEof = true
      } else if (
        (section === 'ENTITIES' || section === 'BLOCKS') &&
        !STRUCTURAL.has(value) &&
        !NOT_DRAWN.has(value)
      ) {
        entities[value] = (entities[value] ?? 0) + 1
        bySection[section] = bySection[section] ?? {}
        bySection[section][value] = (bySection[section][value] ?? 0) + 1
      }
      continue
    }

    if (code === '2' && pendingSectionName) {
      section = value
      pendingSectionName = false
      continue
    }

    // Layer names, wherever they appear — the table may list layers that carry
    // no geometry, and entities may name layers absent from the table.
    if (code === '8' && value) {
      layers.add(value)
      if (section === 'ENTITIES' || section === 'BLOCKS') {
        const row = layerCounts.get(value) ?? { layer: value, inModelSpace: 0, inBlocks: 0 }
        if (section === 'ENTITIES') row.inModelSpace++
        else row.inBlocks++
        layerCounts.set(value, row)
      }
    }
  }

  return {
    entities,
    bySection,
    layers: [...layers].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    layerCounts: [...layerCounts.values()].sort((a, b) =>
      a.layer.localeCompare(b.layer, undefined, { numeric: true }),
    ),
    groups: Math.floor(lines.length / 2),
    truncated: !sawEof,
    lastEntity: lastZeroValue,
  }
}

/**
 * Layers the file mentions that produced no drawn geometry at all.
 *
 * This is the answer to "why is my walls layer blank?" — a question the entity
 * type ledger above cannot answer, because it reports per *type* and a layer
 * can lose everything on it while every type still renders somewhere else.
 *
 * The counts distinguish the two causes that need completely different fixes:
 * entities present in model space but undrawn means this app dropped them (a
 * bug worth reporting), whereas a layer named only by the layer table — or
 * only by entities sitting inside block definitions nothing inserts — means
 * the geometry was never in the file to begin with, which is exactly what an
 * unbound external reference looks like.
 *
 * @param {ReturnType<typeof auditDxf>} audit
 * @param {object} plan output of buildPlan
 */
export function emptyLayers(audit, plan) {
  const drawn = new Set(Object.keys(plan?.layerBounds ?? {}))
  return (audit.layerCounts ?? [])
    // Layer "0" inside a block definition means "whatever layer the block was
    // placed on", so it is drawn under those layers' names and legitimately
    // never under its own. Reporting it would be noise on every file.
    .filter((row) => row.layer !== '0' && !drawn.has(row.layer))
    .map((row) => ({
      ...row,
      // Nothing anywhere in the file put an entity on this layer outside a
      // block definition, so there was never anything here to draw.
      neverInModelSpace: row.inModelSpace === 0,
    }))
}

/**
 * Which entity types in the file this app can actually draw.
 *
 * Deliberately a capability report, not a count reconciliation. Counting
 * occurrences and comparing them to draws is apples-to-oranges: a block
 * definition is written once but drawn once per insertion — and never at all if
 * nothing inserts it — so raw counts would show alarming "losses" that are
 * nothing of the kind. The question worth answering is the binary one: is there
 * anything in here we cannot render?
 *
 * @param {ReturnType<typeof auditDxf>} audit
 * @param {Record<string, number>} rendered types that produced geometry
 * @param {Record<string, number>} deliberate types skipped on purpose (WIPEOUT)
 */
export function reconcile(audit, rendered, deliberate = {}) {
  const rows = []
  for (const [type, found] of Object.entries(audit.entities)) {
    const drawn = rendered[type] ?? 0
    const status = drawn > 0 ? 'ok' : deliberate[type] ? 'skipped' : 'lost'
    rows.push({ type, found, drawn, status, inModelSpace: audit.bySection.ENTITIES?.[type] ?? 0 })
  }
  rows.sort((a, b) => {
    const rank = { lost: 0, skipped: 1, ok: 2 }
    return rank[a.status] - rank[b.status] || b.found - a.found
  })
  return rows
}

/** One-line summary for the import screen. */
export function describeLosses(rows) {
  const lost = rows.filter((r) => r.status === 'lost')
  if (!lost.length) return null
  return lost.map((r) => `${r.found - r.drawn}× ${r.type}`).join(', ')
}
