import { insets } from './units'
import type {
  BlockConfig,
  FlowConfig,
  FrameStyle,
  MasterTemplate,
  Palette,
  SegmentRules,
  StyleSheet,
  TextStyle,
  TitleConfig,
  ZoneConfig,
} from './template'

export const PLEX = 'plex'
export const PLEX_CONDENSED = 'plex-condensed'

/**
 * Neutral by design. Black on white with one accent the user is expected to
 * replace; route colours come from the source data, not from here.
 */
export const defaultPalette = (): Palette => ({
  paper: '#ffffff',
  ink: '#111111',
  muted: '#6b7280',
  accent: '#1f6feb',
  rule: '#d4d4d8',
})

const style = (over: Partial<TextStyle>): TextStyle => ({
  family: PLEX,
  weight: 400,
  italic: false,
  sizePt: 9,
  tracking: 0,
  lineHeight: 1.2,
  color: 'ink',
  transform: 'none',
  ...over,
})

/**
 * Sizes are authored against `REFERENCE_BLOCK_WIDTH`; a narrower block scales
 * all of them together.
 */
export const defaultStyles = (): StyleSheet => ({
  title: style({ sizePt: 17, weight: 600, lineHeight: 1.1 }),
  subtitle: style({ sizePt: 9.5, weight: 400, color: 'muted', lineHeight: 1.25 }),

  routeNumber: style({ sizePt: 19, weight: 700, lineHeight: 1 }),
  destination: style({ sizePt: 11, weight: 600, lineHeight: 1.15 }),
  viaList: style({ sizePt: 6.8, weight: 400, color: 'muted', lineHeight: 1.25 }),

  columnHeader: style({ sizePt: 7.2, weight: 600, color: 'ink' }),
  rowLabel: style({ sizePt: 6.8, weight: 500, color: 'muted', lineHeight: 1.2 }),

  time: style({ sizePt: 12.5, weight: 300, lineHeight: 1.3 }),
  // Separate roles, so a heavy hour can sit against light minutes.
  hour: style({ sizePt: 8.5, weight: 700, lineHeight: 1.35 }),
  minute: style({ sizePt: 8.5, weight: 300, lineHeight: 1.35 }),

  intervalValue: style({ sizePt: 21, weight: 300, lineHeight: 1.05 }),
  intervalUnit: style({ sizePt: 6.8, weight: 400, color: 'muted' }),

  note: style({ sizePt: 6.8, weight: 400, color: 'muted', lineHeight: 1.3 }),
  footerText: style({ sizePt: 6.8, weight: 400, color: 'muted', lineHeight: 1.3 }),
})

export const defaultRules = (): SegmentRules => ({
  headwayTolerance: 5,
  headwayToleranceRatio: 0.5,
  minTripsForInterval: 6,
  maxHeadwayForInterval: 60,
  maxHeadwayRatio: 2.2,
  minSpanForInterval: 120,
  hourlyThreshold: 20,
  firstTripsCount: 2,
  lastTripsCount: 2,
  snapBoundariesToHour: true,
  postMidnightAsHour24: true,
})

export const defaultFlow = (): FlowConfig => ({
  blockWidth: 88,
  columnGap: 10,
  rowGap: 9,
  columns: 'auto',
  stretch: true,
  align: 'left',
  autoFit: true,
  minScale: 0.55,
})

export const defaultBlock = (): BlockConfig => ({
  badge: {
    shape: 'rounded',
    radius: 3,
    fill: 'route',
    inkOnPaper: false,
    topRule: { show: false, thickness: 1.4 },
    width: 15,
    height: 15,
  },
  labelWidth: 19,
  labelGap: 3,
  dayTypeGap: 6,
  sectionGap: 2.6,
  headerGap: 3,
  sectionRule: { show: true, thickness: 0.2, color: 'rule' },
  headerRule: { show: true, thickness: 0.35, color: 'rule' },
  columnHeaderFill: 'none',
  showViaList: true,
  showColumnHeaders: true,
  timesPerRow: 'auto',
  padding: insets(0),
  labels: {
    firstTrips: 'First departures',
    lastTrips: 'Last departures',
    interval: '{from}–{to} every',
    window: '{from}–{to}',
    times: 'Departures',
    hourly: 'Departures',
  },
  intervalUnit: 'minutes',
  intervalSeparator: '–',
})

export const defaultTitle = (): TitleConfig => ({
  template: '{stop}',
  subtitleTemplate: '{direction}',
})

export const defaultTitleFrame = (): FrameStyle => ({
  show: false,
  fill: 'none',
  stroke: 'rule',
  strokeWidth: 0.3,
  radius: 2,
  padding: insets(3, 4),
})

const emptyZone = (height: number): ZoneConfig => ({
  height,
  background: 'none',
  divider: { show: true, thickness: 0.35, color: 'rule' },
  padding: insets(0),
  scale: 1,
  stack: true,
  stackGap: 1.5,
  pictogram: { show: false, source: '', format: 'svg', size: 14, gap: 4, align: 'top' },
  items: [],
})

export const defaultHeaderZone = (): ZoneConfig => {
  const z = emptyZone(26)
  z.items = [
    {
      id: 'header-title',
      kind: 'text',
      x: 0,
      y: 0,
      w: 150,
      h: 10,
      anchorX: 'left',
      anchorY: 'top',
      locked: false,
      text: '{title}',
      role: 'title',
      align: 'left',
      valign: 'top',
      frame: defaultTitleFrame(),
    },
    {
      id: 'header-subtitle',
      kind: 'text',
      x: 0,
      y: 11,
      w: 150,
      h: 7,
      anchorX: 'left',
      anchorY: 'top',
      locked: false,
      text: '{subtitle}',
      role: 'subtitle',
      align: 'left',
      valign: 'top',
    },
  ]
  return z
}

export const defaultFooterZone = (): ZoneConfig => {
  const z = emptyZone(14)
  z.items = [
    {
      id: 'footer-date',
      kind: 'text',
      x: 0,
      y: 0,
      w: 70,
      h: 5,
      anchorX: 'right',
      anchorY: 'bottom',
      locked: false,
      text: 'Printed {date}',
      role: 'footerText',
      align: 'right',
      valign: 'bottom',
    },
  ]
  return z
}

export interface ArtboardPreset {
  id: string
  label: string
  width: number
  height: number
}

/** Common shelter panel sizes, plus the two paper sizes people proof on. */
export const ARTBOARD_PRESETS: ArtboardPreset[] = [
  { id: 'a4p', label: 'A4 portrait', width: 210, height: 297 },
  { id: 'a4l', label: 'A4 landscape', width: 297, height: 210 },
  { id: 'a3p', label: 'A3 portrait', width: 297, height: 420 },
  { id: 'a3l', label: 'A3 landscape', width: 420, height: 297 },
  { id: 'tall', label: 'Shelter panel, tall', width: 200, height: 700 },
  { id: 'wide', label: 'Shelter panel, wide', width: 900, height: 300 },
  { id: 'square', label: 'Shelter panel, square', width: 420, height: 420 },
]

export const createDefaultTemplate = (): MasterTemplate => ({
  id: 'default',
  name: 'Default',
  artboard: {
    width: 210,
    height: 297,
    bleed: 0,
    cropMarks: false,
    margins: insets(12),
  },
  zones: {
    header: defaultHeaderZone(),
    footer: defaultFooterZone(),
  },
  flow: defaultFlow(),
  block: defaultBlock(),
  title: defaultTitle(),
  palette: defaultPalette(),
  styles: defaultStyles(),
  rules: defaultRules(),
})
