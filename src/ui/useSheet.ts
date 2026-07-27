import { useEffect, useMemo, useState } from 'react'
import { getFontBook } from '../layout/fonts.browser'
import { BUNDLED_FONTS, type FontBook } from '../layout/fonts'
import { cssFamily } from '../render/svg'
import { layoutSheet, type Page } from '../layout'
import { buildSheetBlocks } from '../model/sheet'
import { useStore } from '../store'
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
    const id = 'algach-font-faces'
    if (document.getElementById(id)) return

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

/** Lay out one stop's sheet. Returns null while fonts are still loading. */
export const buildPage = (
  book: FontBook,
  project: Project,
  stopId: string,
  date = todayLabel(),
): Page | null => {
  const stop = project.timetable.stops.find((s) => s.id === stopId)
  if (!stop) return null

  const edits = project.edits[stopId] ?? {}
  const blocks = buildSheetBlocks(project.timetable, stopId, project.template, edits)

  return layoutSheet(book, project.template, {
    stop,
    blocks,
    date,
    ...(edits.titleOverride !== undefined ? { titleOverride: edits.titleOverride } : {}),
    ...(edits.subtitleOverride !== undefined ? { subtitleOverride: edits.subtitleOverride } : {}),
  })
}

/** The sheet for whichever stop is selected. */
export const useCurrentPage = (book: FontBook | null): Page | null => {
  const project = useStore((s) => s.project)
  const stopId = useStore((s) => s.selection.stopId)

  return useMemo(() => {
    if (!book || !stopId) return null
    return buildPage(book, project, stopId)
  }, [book, project, stopId])
}

/**
 * Which stops the layout could not fit.
 *
 * Recomputed across the whole network, because a template change that rescues
 * one stop can break another, and finding that out at export time is too late.
 */
export const useOverflowingStops = (book: FontBook | null): Set<string> => {
  const project = useStore((s) => s.project)

  return useMemo(() => {
    const flagged = new Set<string>()
    if (!book) return flagged
    for (const stop of project.timetable.stops) {
      const page = buildPage(book, project, stop.id)
      if (page?.diagnostics.overflow) flagged.add(stop.id)
    }
    return flagged
  }, [book, project])
}
