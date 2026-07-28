import type { Insets } from './units'

/**
 * Type sizes and spacings inside a route block are authored against this
 * nominal block width. Setting a narrower block in the master template scales
 * everything inside it by the same factor, so shrinking a block never means
 * re-tuning fifteen type sizes by hand.
 */
export const REFERENCE_BLOCK_WIDTH = 100

/** Named colour slots. A style may also carry a literal `#rrggbb`. */
export type ColorToken = 'paper' | 'ink' | 'muted' | 'accent' | 'rule'

export interface Palette {
  paper: string
  ink: string
  muted: string
  accent: string
  rule: string
}

export type FontFamilyId = string

export interface TextStyle {
  family: FontFamilyId
  /** CSS-style numeric weight; resolved to the nearest bundled cut. */
  weight: number
  italic: boolean
  /** Points, at the reference block width. */
  sizePt: number
  /** Letter spacing in em. */
  tracking: number
  /** Multiple of the type size. */
  lineHeight: number
  /** Colour token, or a literal `#rrggbb`. */
  color: ColorToken | string
  transform: 'none' | 'uppercase' | 'lowercase'
}

/**
 * Every piece of text on the sheet answers to one of these. `hour` and
 * `minute` are deliberately separate roles: that is what lets an hourly
 * section print a heavy hour against light minutes.
 */
export type StyleRole =
  | 'title'
  | 'subtitle'
  | 'routeNumber'
  | 'destination'
  | 'viaList'
  | 'columnHeader'
  | 'rowLabel'
  | 'time'
  | 'hour'
  | 'minute'
  | 'intervalValue'
  | 'intervalUnit'
  | 'note'
  | 'footerText'

export type StyleSheet = Record<StyleRole, TextStyle>

/** How a route's number is set — a filled chip, an outline, or a rule above it. */
export interface BadgeStyle {
  shape: 'rounded' | 'square' | 'pill' | 'none'
  /** Corner radius in mm at reference width; ignored for pill and square. */
  radius: number
  /** Fill with the route colour, or leave the paper showing. */
  fill: 'route' | 'accent' | 'none'
  /** Number drawn in the route colour rather than reversed out of the fill. */
  inkOnPaper: boolean
  /** Rule drawn above the block in the route colour, instead of / next to a chip. */
  topRule: { show: boolean; thickness: number }
  /** Box size in mm at reference width. */
  width: number
  height: number
}

export interface FrameStyle {
  show: boolean
  fill: ColorToken | string | 'none'
  stroke: ColorToken | string | 'none'
  strokeWidth: number
  radius: number
  padding: Insets
}

/** Thresholds that decide whether a stretch of the day prints as times or as a headway. */
export interface SegmentRules {
  /** A stretch only becomes an interval if headways stay within this many minutes of each other. */
  headwayTolerance: number
  /** …or within this fraction of the stretch's own mean headway, whichever is
   *  more generous. A line running every 12-20 minutes wobbles more in
   *  absolute terms than one running every 4-6, and both are still a headway. */
  headwayToleranceRatio: number
  /** …and only if it has at least this many departures. */
  minTripsForInterval: number
  /** …and only if the mean headway is no longer than this. */
  maxHeadwayForInterval: number
  /** …and only if the longest headway is within this multiple of the shortest.
   *  A quoted range of "every 5-25 minutes" is not useful to anyone. */
  maxHeadwayRatio: number
  /** …and only if it covers at least this many minutes of the day. */
  minSpanForInterval: number
  /** Above this many departures, an irregular stretch prints hourly rather than as a flat list. */
  hourlyThreshold: number
  /** Show this many opening departures explicitly when the day starts on a headway. */
  firstTripsCount: number
  /** Same for the closing departures of the day. */
  lastTripsCount: number
  /** Pull segment boundaries out to whole hours. */
  snapBoundariesToHour: boolean
  /** Print post-midnight departures as 24:37 rather than 00:37. */
  postMidnightAsHour24: boolean
}

/* ------------------------------------------------------------------ zones */

export type ZoneId = 'header' | 'footer'

export interface VectorItemBase {
  id: string
  /** Position in mm, relative to the zone box, before anchoring is applied. */
  x: number
  y: number
  w: number
  h: number
  /** Which edge of the zone the position is measured from. */
  anchorX: 'left' | 'center' | 'right'
  anchorY: 'top' | 'center' | 'bottom'
  locked: boolean
}

export interface VectorTextItem extends VectorItemBase {
  kind: 'text'
  /** May contain `{stop}`, `{direction}`, `{terminals}`, `{routes}`, `{date}`,
   *  plus `{title}` and `{subtitle}` which expand the template's own wording. */
  text: string
  role: StyleRole
  align: 'left' | 'center' | 'right'
  valign: 'top' | 'middle' | 'bottom'
  /** Optional box drawn behind the text — the frame a title can sit in. */
  frame?: FrameStyle
}

export interface VectorImageItem extends VectorItemBase {
  kind: 'image'
  /** Inline SVG markup, or a data URI for raster art. */
  source: string
  format: 'svg' | 'raster'
  fit: 'contain' | 'cover' | 'stretch'
  /** Recolour a monochrome mark to a palette token. */
  tint?: ColorToken | string
}

export interface VectorShapeItem extends VectorItemBase {
  kind: 'shape'
  shape: 'rect' | 'line'
  fill: ColorToken | string | 'none'
  stroke: ColorToken | string | 'none'
  strokeWidth: number
  radius: number
}

export interface VectorPatternItem extends VectorItemBase {
  kind: 'pattern'
  /** Inline SVG for one tile. */
  source: string
  /** Tile width in mm; height follows the tile's aspect ratio. */
  tileWidth: number
  tint?: ColorToken | string
}

export type VectorItem = VectorTextItem | VectorImageItem | VectorShapeItem | VectorPatternItem

export interface ZoneConfig {
  /** Reserved height in mm. Content is laid out in what is left over, so a
   *  taller footer pushes the schedule up rather than being drawn over it. */
  height: number
  background: ColorToken | string | 'none'
  /** Hairline separating the zone from the content area. */
  divider: { show: boolean; thickness: number; color: ColorToken | string }
  padding: Insets
  /** Zone type is sized against the sheet, not against a route block, so it
   *  stays put when the block width changes. This scales it independently. */
  scale: number
  /**
   * Stack the text items one under another instead of placing them at fixed
   * offsets. Fixed offsets are fine until the title's size is raised, at which
   * point it grows down into the subtitle; stacked, each item starts below the
   * measured bottom of the one before it. Images and shapes keep their own
   * positions either way, so a logo can still sit wherever it is dragged.
   */
  stack: boolean
  /** Space between stacked text items, in mm. */
  stackGap: number
  /** A mark set to the left of the stacked text, aligned with it. */
  pictogram: {
    show: boolean
    /** Inline SVG markup, or a data URI for raster art. */
    source: string
    format: 'svg' | 'raster'
    /** Drawn as a square this many mm wide. */
    size: number
    /** Space between the mark and the text. */
    gap: number
    /** Against the top of the text block, its middle, or its baseline row. */
    align: 'top' | 'middle' | 'bottom'
  }
  items: VectorItem[]
}

/* --------------------------------------------------------------- template */

export interface ArtboardConfig {
  width: number
  height: number
  /** Print bleed in mm; 0 for a sheet that is not trimmed. */
  bleed: number
  /** Draw crop marks outside the trim box. */
  cropMarks: boolean
  margins: Insets
}

export interface FlowConfig {
  /** Nominal route-block width in mm. Drives both how many fit per row and
   *  how large the type inside them is. */
  blockWidth: number
  columnGap: number
  rowGap: number
  /** `auto` derives the count from the artboard; a number forces it and
   *  stretches blocks to fill the row. */
  columns: 'auto' | number
  /** Widen blocks to fill the row. Off, a block is drawn at exactly its
   *  nominal width, so trimming that width shrinks the block continuously
   *  instead of only when the column count next changes. */
  stretch: boolean
  /** Where a non-stretched row sits in the content area. */
  align: 'left' | 'center' | 'right'
  /** Shrink type and spacing to rescue an overflowing sheet. */
  autoFit: boolean
  /** Floor for auto-fit — below this the sheet is flagged rather than shrunk. */
  minScale: number
}

export interface BlockConfig {
  badge: BadgeStyle
  /** Width of the left label gutter, in mm at reference width. This is what
   *  keeps rows aligned across every block on the sheet. */
  labelWidth: number
  /** Space between the label gutter and the first day-type column. */
  labelGap: number
  /** Gap between day-type columns. */
  dayTypeGap: number
  /** Vertical gap between sections within a block. */
  sectionGap: number
  /** Space under the route header, before the first section. */
  headerGap: number
  /** Rules between sections. */
  sectionRule: { show: boolean; thickness: number; color: ColorToken | string }
  /** Rule under the route header. */
  headerRule: { show: boolean; thickness: number; color: ColorToken | string }
  /** Tint behind the day-type column headings. */
  columnHeaderFill: ColorToken | string | 'none'
  showViaList: boolean
  showColumnHeaders: boolean
  /** Times per row in a flat departure list; `auto` fits as many as will go. */
  timesPerRow: 'auto' | number
  padding: Insets
  /** Wording of the left-hand row labels. `{from}` and `{to}` carry the hours
   *  of a headway stretch. */
  labels: {
    firstTrips: string
    lastTrips: string
    interval: string
    /** Used when only some columns of a row show a headway, so the row cannot
     *  honestly say "every". */
    window: string
    times: string
    hourly: string
    /** Heading above the night-routes list at the foot of the sheet. */
    nightRoutes: string
  }
  /** Unit printed under a headway figure. */
  intervalUnit: string
  /** What sits between the two ends of a headway range: `8–10`, `8~10`. */
  intervalSeparator: string
  /** A range no wider than this, in minutes, prints as one averaged figure
   *  (`~9`) instead of the two ends (`8–10`) — the ends are real evidence but
   *  not worth making a rider do arithmetic over a couple of minutes. */
  intervalAverageThreshold: number
  /** Printed in front of an averaged figure. */
  intervalAveragePrefix: string
}

/**
 * The wording at the top of every sheet. Held here rather than typed into the
 * header item so it can be reworded once for a whole city.
 */
export interface TitleConfig {
  /** Tokens: `{stop}` `{direction}` `{terminals}` `{routes}` `{date}`. */
  template: string
  subtitleTemplate: string
}

export interface MasterTemplate {
  id: string
  name: string
  artboard: ArtboardConfig
  zones: Record<ZoneId, ZoneConfig>
  flow: FlowConfig
  block: BlockConfig
  title: TitleConfig
  palette: Palette
  styles: StyleSheet
  rules: SegmentRules
}

/** Resolve a style's colour reference against the palette. */
export const resolveColor = (c: ColorToken | string, palette: Palette): string => {
  if (c in palette) return palette[c as ColorToken]
  return c
}
