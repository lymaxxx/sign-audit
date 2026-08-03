/**
 * A second DXF used purely as background reference — the walls from a
 * different export of the same site, say, brought in to align against
 * signage detected from the primary drawing.
 *
 * This deliberately reuses the same parse/bake pipeline as the primary
 * drawing (so anything the app can draw at all, it draws here too) but drops
 * everything sign-detection needs: no INSERT/attribute bookkeeping, no layer
 * toggles, no sign candidates. It is passive geometry, not a second audit.
 */

import { looksLikeDxf, parseDxf } from '../dxf/parse.js'
import { auditDxf } from '../dxf/audit.js'
import { buildPlan } from '../dxf/flatten.js'

/**
 * @param {string} text raw DXF file contents
 * @returns {{paths: object[], labels: object[], bounds: object}}
 */
export function buildDxfUnderlay(text) {
  if (!looksLikeDxf(text)) {
    throw new Error(
      'That does not look like an ASCII DXF file. If you have a DWG, export it as DXF first.',
    )
  }
  const census = auditDxf(text)
  const dxf = parseDxf(text, census)
  const plan = buildPlan(dxf, {})
  return { paths: plan.paths, labels: plan.labels, bounds: plan.bounds }
}
