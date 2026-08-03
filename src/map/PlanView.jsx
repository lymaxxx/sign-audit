import { memo, useEffect, useId, useRef, useState } from 'react'
import SignMarkers from './SignMarkers.jsx'
import { visibleBounds } from './useViewport.js'
import { normaliseBox } from '../dxf/crop.js'
import { underlayMatrixString } from '../underlay/geometry.js'

/**
 * The plan canvas: baked CAD geometry, optional text, and sign markers.
 *
 * Geometry arrives from the importer as one path per (layer, colour), so this
 * renders a couple of dozen nodes no matter how large the drawing was.
 * `vector-effect: non-scaling-stroke` keeps line weight at 1px through any
 * zoom, which is what CAD line work should look like.
 */

// Below this on-screen height, plan text is an unreadable smudge and is skipped.
const MIN_LABEL_PX = 6

const LayerPaths = memo(function LayerPaths({ paths, hiddenKey, hiddenBlocksKey, backdropKey }) {
  const hidden = new Set(hiddenKey ? hiddenKey.split('\n') : [])
  const hiddenBlocks = new Set(hiddenBlocksKey ? hiddenBlocksKey.split('\n') : [])
  const backdrop = new Set(backdropKey ? backdropKey.split('\n') : [])
  const visible = paths.filter(
    (path) => !hidden.has(path.layer) && !(path.sourceBlock && hiddenBlocks.has(path.sourceBlock)),
  )
  // Backdrop layers (e.g. an XREF'd wall shell) are passive context, so they
  // sit behind everything else regardless of where they fall in the bake —
  // ordinary layer order only guarantees fills stay under line work.
  const ordered = [...visible].sort(
    (a, b) => Number(backdrop.has(a.layer)) - Number(backdrop.has(b.layer)),
  )
  return (
    <g strokeWidth={1} strokeLinecap="round" strokeLinejoin="round">
      {ordered.map((path, index) => {
        const muted = backdrop.has(path.layer)
        return path.filled ? (
          // Solid hatches. even-odd keeps holes in ring-shaped fills, and the
          // slight transparency stops a large filled area burying line work.
          <path
            key={`${path.layer}-${path.color}-${index}`}
            d={path.d}
            fill={path.color}
            fillRule="evenodd"
            fillOpacity={muted ? 0.2 : 0.55}
            stroke="none"
            style={muted ? { pointerEvents: 'none' } : undefined}
          />
        ) : (
          <path
            key={`${path.layer}-${path.color}-${index}`}
            d={path.d}
            fill="none"
            stroke={muted ? 'var(--ink-dim)' : path.color}
            strokeOpacity={muted ? 0.5 : 1}
            vectorEffect="non-scaling-stroke"
            style={muted ? { pointerEvents: 'none' } : undefined}
          />
        )
      })}
    </g>
  )
})

const Labels = memo(function Labels({ labels, view, size, hiddenKey, hiddenBlocksKey, backdropKey }) {
  const hidden = new Set(hiddenKey ? hiddenKey.split('\n') : [])
  const hiddenBlocks = new Set(hiddenBlocksKey ? hiddenBlocksKey.split('\n') : [])
  const backdrop = new Set(backdropKey ? backdropKey.split('\n') : [])
  const box = visibleBounds(view, size, 200)
  const minSize = MIN_LABEL_PX / (view.scale || 1)

  // Backdrop text (room numbers, xref annotation) is not what the plan is for
  // here — it is passive context, not something to read — so it is dropped
  // rather than dimmed, to keep the plan's own labels uncluttered.
  const shown = labels.filter(
    (l) =>
      l.size >= minSize &&
      !hidden.has(l.layer) &&
      !backdrop.has(l.layer) &&
      !(l.sourceBlock && hiddenBlocks.has(l.sourceBlock)) &&
      (!box || (l.x >= box.minX && l.x <= box.maxX && l.y >= box.minY && l.y <= box.maxY)),
  )

  return (
    <g style={{ pointerEvents: 'none' }}>
      {shown.map((label, index) => (
        <text
          key={index}
          // The local scale(1,-1) undoes the root Y flip so text is not
          // mirrored; the rotation flips sign for the same reason.
          transform={`translate(${label.x} ${label.y}) scale(1 -1) rotate(${-label.angle})`}
          fontSize={label.size}
          fill={label.color}
          opacity={0.85}
        >
          {label.text}
        </text>
      ))}
    </g>
  )
})

/**
 * A reference image or drawing placed behind the plan — a PDF plot rasterised
 * to a page, or a second DXF's baked geometry. It is never interactive: only
 * the dial of controls in the panel above the plan, plus dragging in align
 * mode (handled by the parent, since that has to steal the pan gesture),
 * change how it sits.
 */
const Underlay = memo(function Underlay({ underlay, meta, imageUrl, showOutline }) {
  if (!underlay || !meta) return null
  const matrix = underlayMatrixString(meta.transform, underlay)
  const box =
    underlay.kind === 'image'
      ? { minX: 0, minY: 0, maxX: underlay.width, maxY: underlay.height }
      : underlay.bounds

  return (
    <>
      <g transform={matrix} opacity={meta.opacity} style={{ pointerEvents: 'none' }}>
        {underlay.kind === 'image' ? (
          imageUrl && (
            <image href={imageUrl} x={0} y={0} width={underlay.width} height={underlay.height} />
          )
        ) : (
          <>
            <g strokeWidth={1} strokeLinecap="round" strokeLinejoin="round">
              {underlay.paths.map((path, index) =>
                path.filled ? (
                  <path key={index} d={path.d} fill={path.color} fillRule="evenodd" stroke="none" />
                ) : (
                  <path
                    key={index}
                    d={path.d}
                    fill="none"
                    stroke={path.color}
                    vectorEffect="non-scaling-stroke"
                  />
                ),
              )}
            </g>
            {underlay.labels?.map((label, index) => (
              <text
                key={index}
                transform={`translate(${label.x} ${label.y}) scale(1 -1) rotate(${-label.angle})`}
                fontSize={label.size}
                fill={label.color}
              >
                {label.text}
              </text>
            ))}
          </>
        )}
      </g>
      {showOutline && (
        <g transform={matrix} style={{ pointerEvents: 'none' }}>
          <rect
            x={box.minX}
            y={box.minY}
            width={box.maxX - box.minX}
            height={box.maxY - box.minY}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
            strokeDasharray="8 5"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      )}
    </>
  )
})

export default function PlanView({
  plan,
  project,
  signs,
  selectedId,
  onSelectSign,
  addMode,
  onAddAt,
  viewport,
  hiddenBlocks,
  backdropLayers,
  cropMode,
  onCropDrawn,
  underlay,
  underlayMeta,
  alignMode,
  onUnderlayDrag,
}) {
  const { containerRef, size, view, transform, handlers, toWorld, fitTo, wasDrag } = viewport
  const fittedFor = useRef(null)
  const clipId = useId()
  // The rectangle currently being dragged out, in world units. Local state
  // rather than a ref so the outline follows the finger as it moves.
  const [dragBox, setDragBox] = useState(null)
  const dragStart = useRef(null)
  const alignStart = useRef(null)

  // The underlay's raster image only ever exists as a Blob in storage; an
  // object URL is what an <image> element can actually point at. Created only
  // when the underlying Blob reference changes, not on every render, and
  // revoked on the way out so a session that swaps through several PDFs does
  // not leak one URL per attempt.
  const [imageUrl, setImageUrl] = useState(null)
  useEffect(() => {
    if (underlay?.kind !== 'image') {
      setImageUrl(null)
      return
    }
    const url = URL.createObjectURL(underlay.blob)
    setImageUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [underlay])

  // Fit the drawing the first time we know both the plan and the viewport size.
  useEffect(() => {
    if (!project || !size.width || !size.height) return
    if (fittedFor.current === project.id) return
    fittedFor.current = project.id
    fitTo(project.crop ?? project.bounds)
  }, [project, size.width, size.height, fitTo])

  const hiddenKey = (project?.layers ?? [])
    .filter((l) => !l.visible)
    .map((l) => l.name)
    .join('\n')
  const hiddenBlocksKey = [...(hiddenBlocks ?? [])].join('\n')
  const backdropKey = [...(backdropLayers ?? [])].join('\n')

  // Cropping filters whole entities, so a wall that starts inside the region
  // and runs far outside it is kept in full. Clipping the rendered geometry
  // as well is what makes the region read as a region rather than as a
  // slightly smaller drawing.
  const crop = project?.crop ?? null

  // While drawing a crop box, or dragging the underlay into place, the pan/
  // zoom gestures have to stand down — otherwise the same drag would also pan
  // the plan out from under whatever is being positioned.
  const activeHandlers = cropMode
    ? {
        onPointerDown(event) {
          event.currentTarget.setPointerCapture?.(event.pointerId)
          const point = toWorld(event.clientX, event.clientY)
          dragStart.current = point
          setDragBox(normaliseBox(point, point))
        },
        onPointerMove(event) {
          if (!dragStart.current) return
          setDragBox(normaliseBox(dragStart.current, toWorld(event.clientX, event.clientY)))
        },
        onPointerUp(event) {
          if (!dragStart.current) return
          const box = normaliseBox(dragStart.current, toWorld(event.clientX, event.clientY))
          dragStart.current = null
          setDragBox(null)
          onCropDrawn?.(box)
        },
        onPointerCancel() {
          dragStart.current = null
          setDragBox(null)
        },
      }
    : alignMode && underlayMeta
      ? {
          onPointerDown(event) {
            event.currentTarget.setPointerCapture?.(event.pointerId)
            alignStart.current = {
              start: toWorld(event.clientX, event.clientY),
              x0: underlayMeta.transform.x,
              y0: underlayMeta.transform.y,
            }
          },
          onPointerMove(event) {
            if (!alignStart.current) return
            const { start, x0, y0 } = alignStart.current
            const point = toWorld(event.clientX, event.clientY)
            onUnderlayDrag?.({ x: x0 + (point.x - start.x), y: y0 + (point.y - start.y) })
          },
          onPointerUp() {
            alignStart.current = null
          },
          onPointerCancel() {
            alignStart.current = null
          },
        }
      : handlers

  const outline = dragBox ?? null

  return (
    <div
      ref={containerRef}
      className={`plan ${addMode ? 'plan--adding' : ''} ${cropMode ? 'plan--cropping' : ''} ${alignMode ? 'plan--aligning' : ''}`}
      {...activeHandlers}
      onClick={(event) => {
        if (!addMode || wasDrag()) return
        const point = toWorld(event.clientX, event.clientY)
        onAddAt(point.x, point.y)
      }}
    >
      <svg className="plan__svg" width="100%" height="100%" role="presentation">
        {crop && (
          <defs>
            <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
              <rect
                x={crop.minX}
                y={crop.minY}
                width={crop.maxX - crop.minX}
                height={crop.maxY - crop.minY}
              />
            </clipPath>
          </defs>
        )}
        <g transform={transform}>
          <Underlay underlay={underlay} meta={underlayMeta} imageUrl={imageUrl} showOutline={alignMode} />
          <g clipPath={crop ? `url(#${clipId})` : undefined}>
            {plan?.paths?.length ? (
              <LayerPaths
                paths={plan.paths}
                hiddenKey={hiddenKey}
                hiddenBlocksKey={hiddenBlocksKey}
                backdropKey={backdropKey}
              />
            ) : null}
            {project?.showLabels && plan?.labels?.length ? (
              <Labels
                labels={plan.labels}
                view={view}
                size={size}
                hiddenKey={hiddenKey}
                hiddenBlocksKey={hiddenBlocksKey}
                backdropKey={backdropKey}
              />
            ) : null}
          </g>
          <SignMarkers
            signs={signs}
            view={view}
            size={size}
            selectedId={selectedId}
            onSelect={(id) => {
              if (!wasDrag()) onSelectSign(id)
            }}
          />
          {outline && (
            <rect
              x={outline.minX}
              y={outline.minY}
              width={outline.maxX - outline.minX}
              height={outline.maxY - outline.minY}
              fill="var(--accent)"
              fillOpacity={0.12}
              stroke="var(--accent)"
              strokeWidth={2}
              strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: 'none' }}
            />
          )}
        </g>
      </svg>
    </div>
  )
}
