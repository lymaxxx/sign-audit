/**
 * DXF file -> parsed document.
 *
 * Wraps `dxf-parser`, registering the extra entity handlers in `handlers.js`
 * that fill the library's gaps, and turning its internal failures into
 * something a person can act on.
 */

import DxfParser from 'dxf-parser'
import log from 'loglevel'
import { EXTRA_HANDLERS } from './handlers.js'

// dxf-parser logs a warning for every entity type it has no handler for.
// A drawing with thousands of them would spend real time in console formatting.
log.setLevel('error')

/**
 * ATTRIBs follow their INSERT in file order, terminated by SEQEND. Hang them
 * off the INSERT and drop them from the list so downstream code sees one
 * entity per block reference.
 */
function attachAttributes(entities) {
  const result = []
  let host = null
  for (const entity of entities) {
    if (entity.type === 'ATTRIB') {
      if (host) {
        host.attribs = host.attribs ?? []
        host.attribs.push(entity)
      }
      continue
    }
    if (entity.type === 'SEQEND') {
      host = null
      continue
    }
    host = entity.type === 'INSERT' ? entity : null
    result.push(entity)
  }
  return result
}

/**
 * Turn a library exception into a message that says what to do about it.
 *
 * The raw errors are group-code level ("Expected code for point value to be 20
 * but got 30") and mean nothing to someone holding a drawing.
 */
export function explainParseFailure(error, audit) {
  const message = String(error?.message ?? error)
  const where = audit?.lastEntity ? ` The last entity read was ${audit.lastEntity}.` : ''

  if (/Unexpected end of input|after EOF group/.test(message)) {
    return `The drawing appears to be truncated — it ends part-way through. Re-export it from your CAD application and try again.${where}`
  }
  if (/Expected code for point value/.test(message)) {
    return `A coordinate in the drawing is malformed, and this DXF reader stops at the first one.${where} Re-saving the file as DXF from AutoCAD usually cleans this up.`
  }
  if (/Empty file/.test(message)) {
    return 'That file is empty.'
  }
  if (/cannot be cast to Boolean/.test(message)) {
    return `The drawing contains a malformed flag value.${where} Re-exporting as DXF usually cleans this up.`
  }
  return `This drawing could not be read: ${message}${where}`
}

/**
 * @param {string} text raw DXF file contents
 * @returns {{header: object, entities: object[], blocks: object, tables: object}}
 * @throws {Error} with a human-readable message
 */
/**
 * Close off a file that stops part-way through.
 *
 * The scanner throws the moment it runs out of groups while still looking for
 * a section end, which loses everything that was read up to that point. A
 * drawing that was cut short in transfer is still mostly intact, and mostly
 * intact is far more useful to someone on site than an error message, so the
 * closing markers are supplied and the parse retried.
 */
function closeTruncated(text) {
  const lines = text.replace(/\s+$/, '').split(/\r\n|\r|\n/)
  // A DXF is a stream of code/value line pairs. A file cut mid-pair leaves a
  // dangling code, which offsets every pair after it — so drop it before
  // appending anything, or the repair is worse than the damage.
  if (lines.length % 2 !== 0) lines.pop()
  // Close whatever might still be open. The parser skips terminators it is not
  // looking for, so an unnecessary one is harmless; a missing one is fatal.
  lines.push('  0', 'ENDBLK', '  0', 'ENDSEC', '  0', 'EOF')
  return `${lines.join('\n')}\n`
}

export function parseDxf(text, audit = null) {
  const parse = (source) => {
    const parser = new DxfParser()
    for (const Handler of EXTRA_HANDLERS) parser.registerEntityHandler(Handler)
    return parser.parseSync(source)
  }

  let dxf
  try {
    dxf = parse(text)
  } catch (error) {
    if (/Unexpected end of input|after EOF group/.test(String(error?.message))) {
      try {
        dxf = parse(closeTruncated(text))
        if (dxf) dxf.recovered = 'truncated'
      } catch {
        throw new Error(explainParseFailure(error, audit), { cause: error })
      }
    } else {
      throw new Error(explainParseFailure(error, audit), { cause: error })
    }
  }
  if (!dxf) throw new Error('This file could not be read as a DXF drawing.')

  dxf.entities = attachAttributes(dxf.entities ?? [])
  for (const block of Object.values(dxf.blocks ?? {})) {
    if (block.entities) block.entities = attachAttributes(block.entities)
  }
  return dxf
}

/** True for files that at least look like ASCII DXF, for a friendlier error. */
export function looksLikeDxf(text) {
  return /^\s*0\s*[\r\n]+\s*SECTION/i.test(text.slice(0, 4096))
}
