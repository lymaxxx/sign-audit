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
    if (code === '8' && value) layers.add(value)
  }

  return {
    entities,
    bySection,
    layers: [...layers].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    groups: Math.floor(lines.length / 2),
    truncated: !sawEof,
    lastEntity: lastZeroValue,
  }
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
