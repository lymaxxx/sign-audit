import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { getFontBook } from '../layout/fonts.browser'
import { BUNDLED_FONTS, type FontBook } from '../layout/fonts'
import { cssFamily } from '../render/svg'
import { layoutSheet, type Page } from '../layout'
import type { MasterTemplate } from '../model/template'
import { buildSheetBlocks } from '../model/sheet'
import { useStore, resolveTemplate, resolveTemplateId } from '../store'
import type { Project } from '../store'

/**
 * Fonts are needed before anything can be measured, so the preview waits for
 * them rather than laying out against a guess and jumping when they land.
 */
export const useFontBook = (): FontBook | null => {
  const [book, setBook] = useState<FontBook | null>(null)

  useEffect(() => {
    let live = true
    getFontBook().then((loaded) => {
      if (live) setBook(loaded)
    })
    return () => {
      live = false
    }
  }, [])

  return book
}

/** Point the browser at the same files the engine measured. */
export const useFontFaces = (): void => {
  useEffect(() => {
    const id = 'timetable-font-faces'
    if (document.getElementById(id)) return

    // The single-file build has already declared its faces against embedded
    // data; adding these would only send the browser after files that are not
    // there, since it has no server to ask.
    if (window.__TIMETABLE_FONTS__) return

    const style = document.createElement('style')
    style.id = id
    style.textContent = BUNDLED_FONTS.map(
      (cut) =>
        `@font-face{font-family:"${cssFamily(cut.family)}";font-weight:${cut.weight};` +
        `font-style:${cut.italic ? 'italic' : 'normal'};font-display:block;` +
        `src:url("/fonts/${cut.file}") format("truetype")}`,
    ).join('')
    document.head.appendChild(style)
  }, [])
}

export const todayLabel = (): string =>
  new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * Lay out one stop's sheet, under a given template. Returns null while fonts
 * are still loading.
 *
 * The template is passed in rather than resolved here, so a caller can choose:
 * the live preview edits one template at a time and previews every stop under
 * it, while a real export must resolve each stop's own assigned template.
 */
export const buildPage = (
  book: FontBook,
  tpl: MasterTemplate,
  project: Project,
  stopId: string,
  date = todayLabel(),
  templateId?: string,
): Page | null => {
  const stop = project.timetable.stops.find((s) => s.id === stopId)
  if (!stop) return null

  const edits = project.edits[stopId] ?? {}
  const blocks = buildSheetBlocks(project.timetable, stopId, tpl, edits)

  return layoutSheet(book, tpl, {
    stop,
    blocks,
    date,
    inserts: project.inserts,
    templateId: templateId ?? resolveTemplateId(project, stopId),
    ...(edits.titleOverride !== undefined ? { titleOverride: edits.titleOverride } : {}),
    ...(edits.subtitleOverride !== undefined ? { subtitleOverride: edits.subtitleOverride } : {}),
  })
}

/**
 * The sheet for whichever stop is selected, under the template currently
 * being edited — that is the point of the Inspector, previewing the template
 * you are working on rather than always the stop's real assignment.
 *
 * Laying out a sheet costs enough to be felt between keystrokes, so it runs at
 * a lower priority than the typing that caused it: the field updates at once
 * and the canvas follows a frame or two later. Without this, every character
 * typed into an inspector field waited on a full re-layout before appearing.
 */
export const useCurrentPage = (book: FontBook | null): Page | null => {
  const project = useStore((s) => s.project)
  const stopId = useStore((s) => s.selection.stopId)
  const activeTemplateId = useStore((s) => s.activeTemplateId)
  const deferred = useDeferredValue(project)

  const { timetable, templates, edits, inserts } = deferred
  const template = templates.find((t) => t.id === activeTemplateId)?.template ?? templates[0]!.template
  const stop = stopId ? timetable.stops.find((s) => s.id === stopId) : undefined

  // Segmentation reads only the rules and the row wording. Recomputing it
  // because someone retyped the title meant re-deciding how every route
  // describes its day, on every keystroke, for nothing.
  const shapeKey = JSON.stringify([template.rules, template.block.labels])
  const stopEdits = stopId ? edits[stopId] : undefined

  const blocks = useMemo(() => {
    if (!stop) return null
    return buildSheetBlocks(timetable, stop.id, template, stopEdits ?? {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timetable, stop?.id, shapeKey, stopEdits])

  return useMemo(() => {
    if (!book || !stop || !blocks) return null
    return layoutSheet(book, template, {
      stop,
      blocks,
      date: todayLabel(),
      inserts,
      // The preview follows the template being edited, so the blocks show
      // that template's artwork rather than the stop's assigned one.
      templateId: activeTemplateId,
      ...(stopEdits?.titleOverride !== undefined ? { titleOverride: stopEdits.titleOverride } : {}),
      ...(stopEdits?.subtitleOverride !== undefined ? { subtitleOverride: stopEdits.subtitleOverride } : {}),
    })
  }, [book, template, blocks, stop, stopEdits, inserts, activeTemplateId])
}

/**
 * Which stops the layout could not fit, under each stop's own assigned
 * template — this drives the sidebar's overflow flags and the batch-export
 * report, both of which are about what a stop will really print as.
 *
 * Checked across the whole network, because a template change that rescues one
 * stop can break another, and finding that out at export time is too late.
 *
 * Laying out every sheet is far too expensive to do between keystrokes, so it
 * waits for a pause in the editing. The flags lag the canvas by a moment; the
 * canvas staying responsive is worth more than the flags being instant.
 */
const IDLE_BEFORE_SCAN = 400

export const useOverflowingStops = (book: FontBook | null): Set<string> => {
  const project = useStore((s) => s.project)
  const [flagged, setFlagged] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (!book) return
    let cancelled = false

    const timer = setTimeout(() => {
      const found = new Set<string>()
      for (const stop of project.timetable.stops) {
        if (cancelled) return
        const page = buildPage(book, resolveTemplate(project, stop.id), project, stop.id)
        if (page?.diagnostics.overflow) found.add(stop.id)
      }
      if (!cancelled) setFlagged(found)
    }, IDLE_BEFORE_SCAN)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [book, project])

  return flagged
}
