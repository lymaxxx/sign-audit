import type { Rect } from './units'

/**
 * Blocks of fixed content that belong on every sheet.
 *
 * Fares information, a network map, an advert — things that are the same at
 * every shelter and have nothing to do with any one stop's departures. They
 * are held on the project rather than on a template because one definition
 * has to reach every stop; the artwork itself can still differ per template,
 * so a sponsor's panel can be set differently on a tall shelter than on a
 * square one.
 *
 * They sit between the schedule and the footer, and the content area shrinks
 * to make room — the same subtraction that keeps the schedule clear of the
 * two bands. When a sheet cannot be made to fit even so, the least important
 * of them is dropped rather than letting the departures overflow.
 */

export interface InsertArtwork {
  /** Inline SVG markup, or a data URI for raster art. */
  source: string
  format: 'svg' | 'raster'
}

export interface ContentInsert {
  id: string
  name: string
  enabled: boolean
  /** Nominal width in mm. Drives how many sit side by side across the sheet,
   *  the same way a route block's nominal width drives its grid. */
  width: number
  height: number
  /** Dropped in descending order when the sheet runs out of room, so the
   *  lowest number is the one that survives longest. */
  priority: number
  /** Artwork per template id; `fallback` covers every template without its
   *  own. One upload therefore reaches everywhere unless overridden. */
  variants: Record<string, InsertArtwork>
  fallback?: InsertArtwork
}

export const createInsert = (id: string, name: string): ContentInsert => ({
  id,
  name,
  enabled: true,
  width: 88,
  height: 26,
  priority: 0,
  variants: {},
})

/** The artwork a given template should show for this block, if any. */
export const artworkFor = (insert: ContentInsert, templateId: string): InsertArtwork | undefined => {
  const own = insert.variants[templateId]
  if (own?.source) return own
  return insert.fallback?.source ? insert.fallback : undefined
}

/** Least important first, which is the order they get dropped in. */
export const byDroppingOrder = (inserts: ContentInsert[]): ContentInsert[] =>
  [...inserts].sort((a, b) => b.priority - a.priority)

export interface InsertRow {
  /** Indices into the list that was packed. */
  items: number[]
  height: number
}

export interface InsertPacking {
  rows: InsertRow[]
  /** Total height including the gaps between rows. */
  height: number
}

/**
 * Pack blocks into rows across a given width.
 *
 * Greedy and order-preserving: a block joins the current row while it fits,
 * otherwise it starts a new one. Mixed widths therefore need no special case,
 * and a wide panel puts several side by side exactly as it does route blocks.
 */
export const packInserts = (
  inserts: ContentInsert[],
  contentWidth: number,
  gap: number,
): InsertPacking => {
  if (inserts.length === 0) return { rows: [], height: 0 }

  const rows: InsertRow[] = []
  let current: number[] = []
  let used = 0

  for (const [index, insert] of inserts.entries()) {
    const width = Math.min(insert.width, contentWidth)
    const grown = current.length === 0 ? width : used + gap + width

    if (current.length > 0 && grown > contentWidth) {
      rows.push({ items: current, height: rowHeight(inserts, current) })
      current = [index]
      used = width
    } else {
      current.push(index)
      used = grown
    }
  }
  if (current.length > 0) rows.push({ items: current, height: rowHeight(inserts, current) })

  const height = rows.reduce((sum, row) => sum + row.height, 0) + gap * Math.max(0, rows.length - 1)
  return { rows, height }
}

const rowHeight = (inserts: ContentInsert[], items: number[]): number =>
  Math.max(0, ...items.map((i) => inserts[i]!.height))

/**
 * Where each block lands, given the band's top-left corner.
 *
 * `stretch` shares any width a row did not use between its blocks, so a lone
 * block on a wide sheet fills it rather than sitting in a short stub.
 */
export const placeInserts = (
  inserts: ContentInsert[],
  packing: InsertPacking,
  origin: { x: number; y: number; w: number },
  gap: number,
  stretch: boolean,
): Array<{ insert: ContentInsert; rect: Rect }> => {
  const out: Array<{ insert: ContentInsert; rect: Rect }> = []
  let y = origin.y

  for (const row of packing.rows) {
    const natural = row.items.reduce((sum, i) => sum + Math.min(inserts[i]!.width, origin.w), 0)
    const slack = Math.max(0, origin.w - natural - gap * (row.items.length - 1))
    const share = stretch && row.items.length > 0 ? slack / row.items.length : 0

    let x = origin.x
    for (const index of row.items) {
      const insert = inserts[index]!
      const w = Math.min(insert.width, origin.w) + share
      out.push({ insert, rect: { x, y, w, h: insert.height } })
      x += w + gap
    }
    y += row.height + gap
  }

  return out
}
