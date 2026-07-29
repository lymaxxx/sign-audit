/**
 * DXF file -> parsed document.
 *
 * Wraps `dxf-parser` and fills in the one gap that matters for this app:
 * the library ships a handler for ATTDEF (attribute *definitions*, which live
 * inside a block definition) but none for ATTRIB (attribute *values*, which
 * follow each INSERT in the entity stream). Sign names on a real drawing are
 * almost always ATTRIB values, so without this they would be dropped silently.
 */

import DxfParser from 'dxf-parser'
import log from 'loglevel'

// dxf-parser logs a warning for every entity type it has no handler for.
// A drawing with thousands of SEQENDs or hatches would spend real time in
// console formatting alone.
log.setLevel('error')

/**
 * Parses ATTRIB the way dxf-parser's own handlers do: read groups until the
 * next 0-code. Point components are read as individual codes rather than via
 * the library's parsePoint helper, to avoid a deep import into its internals.
 */
class AttribHandler {
  constructor() {
    this.ForEntityName = 'ATTRIB'
  }

  parseEntity(scanner, curr) {
    const entity = { type: curr.value }
    curr = scanner.next()
    while (!scanner.isEOF()) {
      if (curr.code === 0) break
      switch (curr.code) {
        case 1: // the attribute's value — this is the sign name
          entity.text = curr.value
          break
        case 2: // the attribute's tag — which field this is
          entity.tag = curr.value
          break
        case 8:
          entity.layer = curr.value
          break
        case 10:
          entity.x = curr.value
          break
        case 20:
          entity.y = curr.value
          break
        case 40:
          entity.textHeight = curr.value
          break
        case 50:
          entity.rotation = curr.value
          break
        case 70:
          entity.invisible = (curr.value & 0x01) !== 0
          break
        default:
          break
      }
      curr = scanner.next()
    }
    return entity
  }
}

/** SEQEND carries nothing we need; a no-op handler keeps it out of the logs. */
class SeqEndHandler {
  constructor() {
    this.ForEntityName = 'SEQEND'
  }

  parseEntity(scanner, curr) {
    const entity = { type: curr.value }
    curr = scanner.next()
    while (!scanner.isEOF() && curr.code !== 0) curr = scanner.next()
    return entity
  }
}

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
 * @param {string} text raw DXF file contents
 * @returns {{header: object, entities: object[], blocks: object, tables: object}}
 * @throws if the file is not parseable as DXF
 */
export function parseDxf(text) {
  const parser = new DxfParser()
  parser.registerEntityHandler(AttribHandler)
  parser.registerEntityHandler(SeqEndHandler)

  const dxf = parser.parseSync(text)
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
