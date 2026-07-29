import { getFontBook } from '../layout/fonts.browser'
import { renderPdf, formatFilename } from '../render/pdf'
import { chooseDirectory, openFiles, saveFile, writeInto } from '../platform'
import { useStore, resolveTemplate, type NamedTemplate, type Project } from '../store'
import { buildPage, todayLabel } from './useSheet'
import { migrateTemplate } from '../model/migrate'
import { parseDelimited, parsePastedList } from '../import/csv'
import { parseWorkbook } from '../import/xlsx'
import { guessMapping, importTable } from '../import/table'
import { importGtfs } from '../import/gtfs'
import type { ImportResult } from '../import/types'
import type { Timetable } from '../model/types'

/** Everything the menus and toolbar do. Kept out of the components. */

const encoder = new TextEncoder()

/* ------------------------------------------------------------- persistence */

/** Maps do not survive JSON, so departures travel as pairs. */
const serialiseProject = (project: Project) =>
  JSON.stringify(
    {
      version: 3,
      name: project.name,
      templates: project.templates,
      defaultTemplateId: project.defaultTemplateId,
      inserts: project.inserts,
      edits: project.edits,
      timetable: {
        routes: project.timetable.routes,
        stops: project.timetable.stops,
        dayTypes: project.timetable.dayTypes,
        departures: [...project.timetable.departures.entries()],
      },
    },
    null,
    2,
  )

const deserialiseProject = (text: string): Project => {
  const raw = JSON.parse(text)
  const timetable: Timetable = {
    routes: raw.timetable?.routes ?? [],
    stops: raw.timetable?.stops ?? [],
    dayTypes: raw.timetable?.dayTypes ?? [],
    departures: new Map(raw.timetable?.departures ?? []),
  }

  // A file saved before templates came in the plural carried one under
  // `template`; wrap it into a library of one rather than losing it.
  const templates: NamedTemplate[] = Array.isArray(raw.templates)
    ? raw.templates.map((t: { id: string; name: string; template: unknown }) => ({
        id: t.id,
        name: t.name,
        template: migrateTemplate(t.template),
      }))
    : [{ id: 'default', name: 'Default', template: migrateTemplate(raw.template) }]

  const defaultTemplateId = templates.some((t) => t.id === raw.defaultTemplateId)
    ? raw.defaultTemplateId
    : templates[0]!.id

  return {
    name: raw.name ?? 'Untitled',
    timetable,
    templates,
    defaultTemplateId,
    // Files written before shared blocks existed simply have none.
    inserts: Array.isArray(raw.inserts) ? raw.inserts : [],
    edits: raw.edits ?? {},
  }
}

/**
 * File types.
 *
 * New saves carry the current extensions; the open dialogs also accept the
 * ones the application used when it was called Algach, so nothing anybody has
 * already saved is stranded by the rename.
 */
const PROJECT_FILE = { name: 'Timetable Generator project', extensions: ['tgen', 'algach'] }
const TEMPLATE_FILE = { name: 'Timetable Generator template', extensions: ['tgentpl', 'algachtpl'] }

export const saveProject = async (): Promise<void> => {
  const { project } = useStore.getState()
  await saveFile(
    `${project.name || 'project'}.tgen`,
    encoder.encode(serialiseProject(project)),
    [PROJECT_FILE],
    'application/json',
  )
}

export const openProject = async (): Promise<void> => {
  const [file] = await openFiles([PROJECT_FILE])
  if (!file) return
  useStore.getState().loadProject(deserialiseProject(new TextDecoder().decode(file.bytes)))
}

/** The template currently being edited — the one the Inspector shows. */
export const saveTemplate = async (): Promise<void> => {
  const { project, activeTemplateId } = useStore.getState()
  const active = project.templates.find((t) => t.id === activeTemplateId) ?? project.templates[0]!
  await saveFile(
    `${active.template.name || active.name || 'template'}.tgentpl`,
    encoder.encode(JSON.stringify(active.template, null, 2)),
    [TEMPLATE_FILE],
    'application/json',
  )
}

export const openTemplate = async (): Promise<void> => {
  const [file] = await openFiles([TEMPLATE_FILE])
  if (!file) return
  const loaded = JSON.parse(new TextDecoder().decode(file.bytes))
  useStore.getState().applyTemplate(migrateTemplate(loaded))
}

/* ------------------------------------------------------------------ import */

const isXlsx = (name: string) => /\.xls[xm]?$/i.test(name)
const isZip = (name: string) => /\.zip$/i.test(name)

/** Import a file, working out from its name what it is. */
export const importFile = async (replace: boolean): Promise<void> => {
  const store = useStore.getState()
  const [file] = await openFiles([
    { name: 'Timetables', extensions: ['csv', 'tsv', 'txt', 'xlsx', 'xlsm', 'zip'] },
  ])
  if (!file) return

  store.setBusy(`Reading ${file.name}…`)
  try {
    let result: ImportResult

    if (isZip(file.name)) {
      result = importGtfs(file.bytes)
    } else if (isXlsx(file.name)) {
      const tables = await parseWorkbook(file.bytes)
      // Merge every worksheet; agencies routinely split a network across tabs.
      const merged = tables.map((table) => importTable(table, guessMapping(table.header, table.rows)))
      result = mergeResults(merged)
    } else {
      const table = parseDelimited(new TextDecoder().decode(file.bytes), file.name)
      result = importTable(table, guessMapping(table.header, table.rows))
    }

    if (replace) store.replaceTimetable(result.timetable, result.issues)
    else store.mergeTimetable(result.timetable, result.issues)
  } finally {
    store.setBusy(null)
  }
}

const mergeResults = (results: ImportResult[]): ImportResult => {
  const first = results[0]
  if (!first) {
    return {
      timetable: { routes: [], stops: [], dayTypes: [], departures: new Map() },
      issues: [{ severity: 'error', message: 'The workbook had no usable sheets.' }],
    }
  }

  const out = first
  for (const next of results.slice(1)) {
    const ids = new Set(out.timetable.routes.map((r) => r.id))
    for (const r of next.timetable.routes) if (!ids.has(r.id)) out.timetable.routes.push(r)

    const stopIds = new Set(out.timetable.stops.map((s) => s.id))
    for (const s of next.timetable.stops) if (!stopIds.has(s.id)) out.timetable.stops.push(s)

    const dayIds = new Set(out.timetable.dayTypes.map((d) => d.id))
    for (const d of next.timetable.dayTypes) if (!dayIds.has(d.id)) out.timetable.dayTypes.push(d)

    for (const [key, times] of next.timetable.departures) out.timetable.departures.set(key, times)
    out.issues.push(...next.issues)
  }
  return out
}

/** Paste departures straight against the selected stop. */
export const importPaste = (text: string, stopName: string): ImportResult => {
  const table = parsePastedList(text)
  return importTable(table, guessMapping(table.header, table.rows), { stop: stopName })
}

/* ------------------------------------------------------------------ export */

export interface ExportOptions {
  outlineText: boolean
  filenamePattern: string
  singleFile: boolean
}

export const defaultExportOptions = (): ExportOptions => ({
  outlineText: false,
  filenamePattern: '{code} {stop}',
  singleFile: false,
})

/** The stop on screen. */
export const exportCurrent = async (options: ExportOptions): Promise<void> => {
  const store = useStore.getState()
  const { project, selection } = store
  if (!selection.stopId) return

  store.setBusy('Writing PDF…')
  try {
    const book = await getFontBook()
    const page = buildPage(book, resolveTemplate(project, selection.stopId), project, selection.stopId)
    if (!page) return

    const stop = project.timetable.stops.find((s) => s.id === selection.stopId)!
    const bytes = await renderPdf(book, [page], {
      outlineText: options.outlineText,
      title: stop.name,
      subject: `Departures from ${stop.name}`,
    })

    const name = formatFilename(options.filenamePattern, {
      stop: stop.name,
      code: stop.code ?? '',
      date: todayLabel(),
      index: 1,
    })
    await saveFile(name, bytes, [{ name: 'PDF', extensions: ['pdf'] }], 'application/pdf')
  } finally {
    store.setBusy(null)
  }
}

export interface BatchReport {
  written: number
  overflowing: string[]
  destination: string | null
}

/**
 * Every stop, in one go.
 *
 * This is the point of the whole thing: the sheets differ from shelter to
 * shelter because the same trip reaches each of them at a different minute,
 * and nobody is going to set a thousand of them by hand.
 */
export const exportAll = async (
  options: ExportOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<BatchReport> => {
  const store = useStore.getState()
  const { project } = store
  const stops = project.timetable.stops
  const date = todayLabel()
  const overflowing: string[] = []

  const book = await getFontBook()

  if (options.singleFile) {
    const pages = []
    for (const [index, stop] of stops.entries()) {
      const page = buildPage(book, resolveTemplate(project, stop.id), project, stop.id, date)
      if (!page) continue
      if (page.diagnostics.overflow) overflowing.push(stop.name)
      pages.push(page)
      onProgress?.(index + 1, stops.length)
    }
    const bytes = await renderPdf(book, pages, {
      outlineText: options.outlineText,
      title: project.name,
      subject: `${pages.length} stops`,
    })
    await saveFile(`${project.name || 'stops'}.pdf`, bytes, [{ name: 'PDF', extensions: ['pdf'] }], 'application/pdf')
    return { written: pages.length, overflowing, destination: null }
  }

  const directory = await chooseDirectory()
  let written = 0

  for (const [index, stop] of stops.entries()) {
    const page = buildPage(book, resolveTemplate(project, stop.id), project, stop.id, date)
    if (!page) continue
    if (page.diagnostics.overflow) overflowing.push(stop.name)

    const bytes = await renderPdf(book, [page], {
      outlineText: options.outlineText,
      title: stop.name,
    })
    const name = formatFilename(options.filenamePattern, {
      stop: stop.name,
      code: stop.code ?? '',
      date,
      index: index + 1,
    })

    if (directory) await writeInto(directory, name, bytes)
    else await saveFile(name, bytes, [{ name: 'PDF', extensions: ['pdf'] }], 'application/pdf')

    written++
    onProgress?.(written, stops.length)
  }

  return { written, overflowing, destination: directory }
}
