/**
 * Parsed DXF -> a flat, render-ready plan model.
 *
 * Block references are expanded recursively so that all geometry ends up in
 * world coordinates, and geometry is baked down to one SVG path per
 * (layer, colour) pair. That last part is what keeps the app usable on a
 * phone: a 40k-entity drawing becomes a couple of dozen DOM nodes.
 */

import {
  IDENTITY,
  emitEntity,
  emptyBounds,
  insertMatrix,
  isEmptyBounds,
  multiply,
  textPlacement,
} from './geometry.js'
import { isLeaderShape } from './link.js'

const MAX_BLOCK_DEPTH = 8
// Plans carry a lot of incidental text (dimensions, notes). Past this many
// labels the DOM cost outweighs the value, and the sign list is the real index.
const MAX_LABELS = 4000

const TEXT_TYPES = new Set(['TEXT', 'MTEXT'])

// ATTDEF is the placeholder inside a block definition ("SIGN_NAME"), replaced
// at each insertion by the ATTRIB value. Drawing it would stamp the same
// placeholder across the plan once per block reference, and offering it as a
// name source would name every sign identically. It is dropped on purpose.
const IGNORED_TYPES = new Set(['ATTDEF', 'SEQEND', 'VIEWPORT'])

/** Strip MTEXT inline formatting so labels read as plain text. */
export function cleanText(raw) {
  if (typeof raw !== 'string') return ''
  return raw
    .replace(/\\P/g, ' ')
    .replace(/\\[A-Za-z]+[^;\\]*;/g, '')
    .replace(/[{}]/g, '')
    .replace(/\\~/g, ' ')
    .replace(/%%[dpc]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function toHex(color) {
  if (typeof color !== 'number' || !Number.isFinite(color)) return null
  const hex = `#${(color & 0xffffff).toString(16).padStart(6, '0')}`
  // Drawings render on a dark canvas, mirroring CAD model space, so pure black
  // would be invisible.
  return hex === '#000000' ? '#ffffff' : hex
}

const DEFAULT_COLOR = '#d8dee9'

function layerColors(dxf) {
  const map = new Map()
  const layers = dxf.tables?.layer?.layers ?? {}
  for (const [name, layer] of Object.entries(layers)) {
    map.set(name, toHex(layer.color) ?? DEFAULT_COLOR)
  }
  return map
}

/**
 * DXF colour inheritance: index 256 is ByLayer, index 0 is ByBlock (inherit
 * from the INSERT that placed this entity), anything else is explicit.
 */
function resolveColor(entity, layerColor, blockColor) {
  if (entity.colorIndex === 0) return blockColor ?? layerColor
  if (entity.colorIndex == null || entity.colorIndex === 256) return layerColor
  return toHex(entity.color) ?? layerColor
}

/** Array (MINSERT) offsets for a block reference; a single [0,0] for plain ones. */
function insertGrid(insert) {
  const cols = Math.max(1, Math.min(insert.columnCount || 1, 100))
  const rows = Math.max(1, Math.min(insert.rowCount || 1, 100))
  if (cols === 1 && rows === 1) return [[0, 0]]
  const dx = insert.columnSpacing || 0
  const dy = insert.rowSpacing || 0
  const offsets = []
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) offsets.push([c * dx, r * dy])
  }
  return offsets
}

/**
 * @param {object} dxf output of parseDxf
 * @param {{fileName?: string}} [meta]
 */
export function buildPlan(dxf, meta = {}) {
  // Bounds are tracked per layer, not just once globally, so a layer toggle
  // can refit the viewport to whatever is actually still visible rather than
  // sitting at the whole drawing's extent (see unionBounds in geometry.js).
  const layerBoundsMap = new Map()
  const boundsFor = (layer) => {
    let b = layerBoundsMap.get(layer)
    if (!b) {
      b = emptyBounds()
      layerBoundsMap.set(layer, b)
    }
    return b
  }

  const colors = layerColors(dxf)
  const buckets = new Map()
  const labels = []
  const inserts = []
  const unsupported = new Map()
  const rendered = new Map()
  const skipped = new Map()
  const usedLayers = new Set()
  let entityCount = 0

  // The bucket carries its own layer/colour rather than encoding them in the
  // key, because layer names routinely contain spaces, dashes and dollar signs.
  // Filled and stroked geometry are kept apart so each can be painted its own
  // way without splitting the bake into one path per entity. `sourceBlock` (the
  // raw name of the nearest enclosing top-level INSERT, or null for entities
  // not inside any block) is also part of the key: it is what lets the app
  // hide a tag/callout block's geometry later, once sign detection decides
  // which blocks play that role — a decision made only after this baking runs,
  // and one layer-visibility toggle alone cannot express, since a tag block and
  // a marker block routinely share the same CAD layer. This only fragments
  // buckets for insert-sourced geometry — raw model-space drafting (the bulk of
  // a large drawing) has no enclosing INSERT and keeps merging into one bucket
  // per layer exactly as before.
  const bucketFor = (layer, color, filled, sourceBlock) => {
    const key = `${filled ? 'fill' : 'stroke'}|${layer}|${color}|${sourceBlock ?? ''}`
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { layer, color, filled, sourceBlock: sourceBlock ?? null, commands: [] }
      buckets.set(key, bucket)
    }
    return bucket.commands
  }

  /**
   * @param {object[]} entities
   * @param {number[]} matrix world transform to apply
   * @param {number} depth recursion guard against self-referential blocks
   * @param {string|null} inheritedLayer layer of the placing INSERT, for layer 0
   * @param {string|null} inheritedColor colour for ByBlock entities
   * @param {string[]|null} textSink collects text found inside a block instance
   * @param {string[]} blockPath names of the blocks currently being expanded
   */
  const walk = (entities, matrix, depth, inheritedLayer, inheritedColor, textSink, blockPath) => {
    // The outermost INSERT this entity is being expanded from, or null for
    // entities placed directly in model space. Fixed for the whole call, since
    // blockPath only changes across a recursive call, not within one.
    const sourceBlock = blockPath.length ? blockPath[0] : null

    for (const entity of entities) {
      if (!entity || entity.visible === false) continue
      if (IGNORED_TYPES.has(entity.type)) continue
      entityCount++

      // Layer "0" inside a block means "whatever layer the block was placed on".
      const layer =
        entity.layer && entity.layer !== '0'
          ? entity.layer
          : (inheritedLayer ?? entity.layer ?? '0')
      const layerColor = colors.get(layer) ?? DEFAULT_COLOR
      const color = resolveColor(entity, layerColor, inheritedColor)

      if (entity.type === 'INSERT') {
        const block = dxf.blocks?.[entity.name]
        for (const [ox, oy] of insertGrid(entity)) {
          const placed =
            ox || oy
              ? {
                  ...entity,
                  position: {
                    x: (entity.position?.x ?? 0) + ox,
                    y: (entity.position?.y ?? 0) + oy,
                  },
                }
              : entity
          const local = multiply(matrix, insertMatrix(placed, block?.position))
          const innerText = []

          if (block?.entities?.length && depth < MAX_BLOCK_DEPTH) {
            walk(block.entities, local, depth + 1, layer, color, innerText, [
              ...blockPath,
              entity.name ?? '',
            ])
          }

          const attribs = {}
          for (const a of entity.attribs ?? []) {
            if (a.tag) attribs[a.tag] = cleanText(a.text)
          }
          inserts.push({
            blockName: entity.name ?? '',
            handle: entity.handle ?? null,
            // Composed world transform. Sign detection needs it to measure a
            // block reference's drawn extents, which is how leader lines are
            // matched to the thing they point at. Transient: the plan record
            // persisted to storage keeps only paths and labels.
            matrix: local,
            // Enclosing block names, outermost first. Used to stop a nested
            // block reference being counted as a second, separate sign when
            // its parent block has already been selected.
            parents: blockPath,
            layer,
            x: local[4],
            y: local[5],
            rotation: (Math.atan2(local[1], local[0]) * 180) / Math.PI,
            attribs,
            innerText: innerText.filter(Boolean),
          })
          // Text inside a nested block still counts as text of the outer one.
          if (textSink) textSink.push(...innerText)
        }
        usedLayers.add(layer)
        rendered.set('INSERT', (rendered.get('INSERT') ?? 0) + 1)
        continue
      }

      if (TEXT_TYPES.has(entity.type)) {
        const text = cleanText(entity.text)
        if (!text) continue
        if (textSink) textSink.push(text)
        if (labels.length < MAX_LABELS) {
          labels.push({ layer, color, text, sourceBlock, ...textPlacement(entity, matrix) })
        }
        usedLayers.add(layer)
        rendered.set(entity.type, (rendered.get(entity.type) ?? 0) + 1)
        continue
      }

      // A WIPEOUT is a mask: understood, parsed, and deliberately not drawn.
      // Drawing it would black out whatever it covers.
      if (entity.type === 'WIPEOUT') {
        skipped.set('WIPEOUT', (skipped.get('WIPEOUT') ?? 0) + 1)
        continue
      }

      const filled = entity.type === 'HATCH' && entity.solid === true
      // A model-space leader dog-leg gets its own bucket key, keyed by handle,
      // so its geometry can be individually hidden once sign detection knows
      // which leaders actually connect a marker to a tag (see link.js's
      // `networkLeaderHandles` and the `hiddenBlocks` mechanism it feeds).
      const leaderKey =
        !sourceBlock && !filled && entity.handle && isLeaderShape(entity)
          ? `leader:${entity.handle}`
          : null
      const out = bucketFor(layer, color, filled, sourceBlock ?? leaderKey)
      if (emitEntity(entity, matrix, out, boundsFor(layer))) {
        usedLayers.add(layer)
        rendered.set(entity.type, (rendered.get(entity.type) ?? 0) + 1)
      } else {
        unsupported.set(entity.type, (unsupported.get(entity.type) ?? 0) + 1)
      }
    }
  }

  walk(dxf.entities ?? [], IDENTITY, 0, null, null, null, [])

  // Labels and sign markers sit outside emitEntity, so fold them into their
  // layer's bounds separately.
  for (const l of labels) {
    const b = boundsFor(l.layer)
    if (l.x < b.minX) b.minX = l.x
    if (l.y < b.minY) b.minY = l.y
    if (l.x > b.maxX) b.maxX = l.x
    if (l.y > b.maxY) b.maxY = l.y
  }
  for (const i of inserts) {
    const b = boundsFor(i.layer)
    if (i.x < b.minX) b.minX = i.x
    if (i.y < b.minY) b.minY = i.y
    if (i.x > b.maxX) b.maxX = i.x
    if (i.y > b.maxY) b.maxY = i.y
  }

  const paths = []
  for (const { layer, color, filled, sourceBlock, commands } of buckets.values()) {
    if (commands.length) paths.push({ layer, color, filled, sourceBlock, d: commands.join('') })
  }
  // Fills first so line work stays legible on top of them.
  paths.sort((a, b) => Number(b.filled) - Number(a.filled))

  const layerNames = [...new Set([...usedLayers, ...inserts.map((i) => i.layer)])].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  )

  // The whole-plan box, for callers that just want to fit everything — the
  // union of every layer's own bounds.
  const bounds = emptyBounds()
  for (const b of layerBoundsMap.values()) {
    if (b.minX < bounds.minX) bounds.minX = b.minX
    if (b.minY < bounds.minY) bounds.minY = b.minY
    if (b.maxX > bounds.maxX) bounds.maxX = b.maxX
    if (b.maxY > bounds.maxY) bounds.maxY = b.maxY
  }

  // Plain, JSON-safe per-layer bounds for the viewport to refit against when
  // layer visibility changes. Layers that ended up with no supported geometry
  // at all are left out rather than exported with Infinity min/max.
  const layerBounds = {}
  for (const [layer, b] of layerBoundsMap) {
    if (!isEmptyBounds(b)) layerBounds[layer] = { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY }
  }

  return {
    fileName: meta.fileName ?? 'plan.dxf',
    bounds,
    layerBounds,
    layers: layerNames.map((name) => ({
      name,
      color: colors.get(name) ?? DEFAULT_COLOR,
      visible: true,
    })),
    paths,
    labels,
    inserts,
    stats: {
      entities: entityCount,
      labelsTruncated: labels.length >= MAX_LABELS,
      unsupported: Object.fromEntries(unsupported),
      // Per-type counts of what actually produced geometry, so the import
      // screen can reconcile them against a raw census of the file and report
      // anything the parser dropped instead of claiming nothing was lost.
      rendered: Object.fromEntries(rendered),
      skipped: Object.fromEntries(skipped),
    },
  }
}
