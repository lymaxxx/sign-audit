import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Page } from '../layout'
import { resolveItemRect, zoneRect } from '../layout'
import { renderGuides, renderSvg } from '../render/svg'
import { useActiveTemplate, useStore } from '../store'
import type { ZoneId } from '../model/template'

/**
 * The preview, and the editor for the two bands.
 *
 * The sheet itself is the engine's SVG, untouched. Header and footer items get
 * a thin overlay of draggable boxes on top of it, so what is dragged is the
 * same geometry that will be printed rather than a separate editing model.
 */

const MIN_ITEM = 4

interface DragState {
  itemId: string
  zone: ZoneId
  mode: 'move' | 'resize'
  /** A band's pictogram is not one of its items; it is positioned by the
   *  layout and nudged by an offset, so it is dragged through different
   *  fields. */
  target: 'item' | 'pictogram'
  startX: number
  startY: number
  origin: { x: number; y: number; w: number; h: number }
}

/** What the overlay offers a grip on: a band item, or a band's pictogram. */
interface OverlayTarget {
  zone: ZoneId
  id: string
  target: 'item' | 'pictogram'
  locked: boolean
  title: string
  rect: { x: number; y: number; w: number; h: number }
  /** Where a drag starts from, in the fields it will write back to. */
  origin: { x: number; y: number; w: number; h: number }
}

export const Canvas = ({ page }: { page: Page | null }) => {
  const template = useActiveTemplate()
  const activeTemplateId = useStore((s) => s.activeTemplateId)
  const showGuides = useStore((s) => s.showGuides)
  const zoom = useStore((s) => s.zoom)
  const setZoom = useStore((s) => s.setZoom)
  const selection = useStore((s) => s.selection)
  const selectItem = useStore((s) => s.selectItem)
  const touch = useStore((s) => s.touch)
  const beginGesture = useStore((s) => s.beginGesture)

  const viewportRef = useRef<HTMLDivElement>(null)
  const [fitScale, setFitScale] = useState(2)
  const dragRef = useRef<DragState | null>(null)

  const pxPerMm = zoom === 'fit' ? fitScale : zoom

  // Recompute the fit whenever the sheet or the window changes shape.
  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el || !page) return

    const measure = () => {
      const padding = 64
      const w = (el.clientWidth - padding) / page.width
      const h = (el.clientHeight - padding) / page.height
      setFitScale(Math.max(0.2, Math.min(w, h)))
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [page])

  const svg = useMemo(() => {
    if (!page) return ''
    const guides = showGuides
      ? renderGuides(
          page,
          template.artboard.margins,
          template.zones.header.height,
          template.zones.footer.height,
          template.zones.header.contentGap,
          template.zones.footer.contentGap,
        )
      : undefined
    return renderSvg(page, { includeBleed: page.bleed > 0, ...(guides ? { overlay: guides } : {}) })
  }, [page, showGuides, template])

  /** Boxes for every band item and pictogram, in sheet millimetres. */
  const overlayItems = useMemo((): OverlayTarget[] => {
    if (!page) return []
    const zones: ZoneId[] = ['header', 'footer']

    const items = zones.flatMap((zone) => {
      const config = template.zones[zone]
      const box = zoneRect(template.artboard, template.artboard.margins, config, zone)
      return config.items.map((item): OverlayTarget => ({
        zone,
        id: item.id,
        target: 'item',
        locked: Boolean(item.locked),
        title: item.kind === 'text' ? item.text : item.kind,
        rect: resolveItemRect(item, config, box),
        origin: { x: item.x, y: item.y, w: item.w, h: item.h },
      }))
    })

    // The layout hands these back because it alone knows where the mark
    // landed — it is placed against the measured height of the text beside it.
    const marks = page.handles.map((handle): OverlayTarget => {
      const pictogram = template.zones[handle.zone].pictogram
      return {
        zone: handle.zone,
        id: handle.id,
        target: 'pictogram',
        locked: false,
        title: 'Pictogram',
        rect: { x: handle.x, y: handle.y, w: handle.w, h: handle.h },
        origin: { x: pictogram.offsetX, y: pictogram.offsetY, w: pictogram.size, h: pictogram.size },
      }
    })

    return [...items, ...marks]
  }, [page, template])

  const onPointerDown = useCallback(
    (event: React.PointerEvent, entry: OverlayTarget, mode: 'move' | 'resize') => {
      if (entry.locked) return
      event.stopPropagation()
      event.preventDefault()
      ;(event.target as Element).setPointerCapture(event.pointerId)

      selectItem(entry.zone, entry.id)
      // One undo step for the whole drag, not one per mouse move.
      beginGesture()
      dragRef.current = {
        itemId: entry.id,
        zone: entry.zone,
        mode,
        target: entry.target,
        startX: event.clientX,
        startY: event.clientY,
        origin: { ...entry.origin },
      }
    },
    [beginGesture, selectItem],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return

      const dx = (event.clientX - drag.startX) / pxPerMm
      const dy = (event.clientY - drag.startY) / pxPerMm
      // Whole millimetres unless a modifier asks for finer control.
      const round = (v: number) => (event.altKey ? Math.round(v * 10) / 10 : Math.round(v))

      touch((draft) => {
        const entry = draft.templates.find((t) => t.id === activeTemplateId)
        if (!entry) return
        const zone = entry.template.zones[drag.zone]

        if (drag.target === 'pictogram') {
          if (drag.mode === 'move') {
            // Nudges, not absolute positions, and deliberately unclamped: the
            // mark is allowed outside the band and past the page margin.
            zone.pictogram.offsetX = round(drag.origin.x + dx)
            zone.pictogram.offsetY = round(drag.origin.y + dy)
          } else {
            // Square, so the larger of the two directions wins.
            zone.pictogram.size = Math.max(MIN_ITEM, round(drag.origin.w + Math.max(dx, dy)))
          }
          return
        }

        const item = zone.items.find((i) => i.id === drag.itemId)
        if (!item) return

        if (drag.mode === 'move') {
          // Anchored to the right or bottom, the offset runs the other way.
          item.x = round(drag.origin.x + (item.anchorX === 'right' ? -dx : dx))
          item.y = round(drag.origin.y + (item.anchorY === 'bottom' ? -dy : dy))
        } else {
          item.w = Math.max(MIN_ITEM, round(drag.origin.w + dx))
          item.h = Math.max(MIN_ITEM, round(drag.origin.h + dy))
        }
      })
    },
    [pxPerMm, touch, activeTemplateId],
  )

  const endDrag = useCallback(() => {
    dragRef.current = null
  }, [])

  // Zoom with the trackpad, the way every other canvas does.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const current = zoom === 'fit' ? fitScale : zoom
      setZoom(Math.max(0.2, Math.min(24, current * (1 - event.deltaY / 400))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoom, fitScale, setZoom])

  if (!page) {
    return (
      <div className="canvas-viewport" ref={viewportRef}>
        <p className="empty">Import a timetable, or pick a stop, to see its sheet.</p>
      </div>
    )
  }

  const bleed = page.bleed > 0 ? page.bleed : 0
  const sheetWidth = (page.width + bleed * 2) * pxPerMm
  const sheetHeight = (page.height + bleed * 2) * pxPerMm

  return (
    <div className="canvas-viewport" ref={viewportRef} onPointerDown={() => selectItem(null, null)}>
      <div className="canvas-scroll">
        <div
          className="sheet"
          style={{ width: sheetWidth, height: sheetHeight }}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div className="sheet-svg" dangerouslySetInnerHTML={{ __html: svg }} />

          {overlayItems.map((entry) => {
            const active = selection.itemId === entry.id
            const { rect } = entry
            return (
              <div
                key={entry.id}
                className={
                  `overlay-item${active ? ' is-selected' : ''}${entry.locked ? ' is-locked' : ''}` +
                  `${entry.target === 'pictogram' ? ' is-pictogram' : ''}`
                }
                style={{
                  left: (rect.x + bleed) * pxPerMm,
                  top: (rect.y + bleed) * pxPerMm,
                  width: rect.w * pxPerMm,
                  height: rect.h * pxPerMm,
                }}
                onPointerDown={(e) => onPointerDown(e, entry, 'move')}
                title={entry.title}
              >
                {active && !entry.locked ? (
                  <span className="overlay-handle" onPointerDown={(e) => onPointerDown(e, entry, 'resize')} />
                ) : null}
              </div>
            )
          })}
        </div>
      </div>

      <div className="canvas-status">
        <span>
          {page.width}×{page.height} mm
        </span>
        <span>
          {page.diagnostics.columns} col · {page.diagnostics.blockCount} routes
        </span>
        <span>type {(page.diagnostics.scale * 100).toFixed(0)}%</span>
        {page.diagnostics.fitScale < 1 ? (
          <span className="warn">shrunk to fit ({(page.diagnostics.fitScale * 100).toFixed(0)}%)</span>
        ) : null}
        {page.diagnostics.overflow ? <span className="error">does not fit</span> : null}
        <span className="spacer" />
        <span>{Math.round(pxPerMm * 25.4)} dpi preview</span>
      </div>
    </div>
  )
}
