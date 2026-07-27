import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Page } from '../layout'
import { resolveItemRect, zoneRect } from '../layout'
import { renderGuides, renderSvg } from '../render/svg'
import { useStore } from '../store'
import type { VectorItem, ZoneId } from '../model/template'

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
  startX: number
  startY: number
  origin: { x: number; y: number; w: number; h: number }
}

export const Canvas = ({ page }: { page: Page | null }) => {
  const template = useStore((s) => s.project.template)
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
      ? renderGuides(page, template.artboard.margins, template.zones.header.height, template.zones.footer.height)
      : undefined
    return renderSvg(page, { includeBleed: page.bleed > 0, ...(guides ? { overlay: guides } : {}) })
  }, [page, showGuides, template])

  /** Boxes for every band item, in sheet millimetres. */
  const overlayItems = useMemo(() => {
    if (!page) return []
    const zones: ZoneId[] = ['header', 'footer']
    return zones.flatMap((zone) => {
      const config = template.zones[zone]
      const box = zoneRect(template.artboard, template.artboard.margins, config, zone)
      return config.items.map((item) => ({ zone, item, rect: resolveItemRect(item, config, box) }))
    })
  }, [page, template])

  const onPointerDown = useCallback(
    (event: React.PointerEvent, zone: ZoneId, item: VectorItem, mode: 'move' | 'resize') => {
      if (item.locked) return
      event.stopPropagation()
      event.preventDefault()
      ;(event.target as Element).setPointerCapture(event.pointerId)

      selectItem(zone, item.id)
      // One undo step for the whole drag, not one per mouse move.
      beginGesture()
      dragRef.current = {
        itemId: item.id,
        zone,
        mode,
        startX: event.clientX,
        startY: event.clientY,
        origin: { x: item.x, y: item.y, w: item.w, h: item.h },
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
        const item = draft.template.zones[drag.zone].items.find((i) => i.id === drag.itemId)
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
    [pxPerMm, touch],
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

          {overlayItems.map(({ zone, item, rect }) => {
            const active = selection.itemId === item.id
            return (
              <div
                key={item.id}
                className={`overlay-item${active ? ' is-selected' : ''}${item.locked ? ' is-locked' : ''}`}
                style={{
                  left: (rect.x + bleed) * pxPerMm,
                  top: (rect.y + bleed) * pxPerMm,
                  width: rect.w * pxPerMm,
                  height: rect.h * pxPerMm,
                }}
                onPointerDown={(e) => onPointerDown(e, zone, item, 'move')}
                title={item.kind === 'text' ? item.text : item.kind}
              >
                {active && !item.locked ? (
                  <span
                    className="overlay-handle"
                    onPointerDown={(e) => onPointerDown(e, zone, item, 'resize')}
                  />
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
