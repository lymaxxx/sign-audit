import { memo, useEffect, useRef } from 'react'
import SignMarkers from './SignMarkers.jsx'
import { visibleBounds } from './useViewport.js'

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

const LayerPaths = memo(function LayerPaths({ paths, hiddenKey }) {
  const hidden = new Set(hiddenKey ? hiddenKey.split('\n') : [])
  return (
    <g strokeWidth={1} strokeLinecap="round" strokeLinejoin="round">
      {paths.map((path, index) =>
        hidden.has(path.layer) ? null : path.filled ? (
          // Solid hatches. even-odd keeps holes in ring-shaped fills, and the
          // slight transparency stops a large filled area burying line work.
          <path
            key={`${path.layer}-${path.color}-${index}`}
            d={path.d}
            fill={path.color}
            fillRule="evenodd"
            fillOpacity={0.55}
            stroke="none"
          />
        ) : (
          <path
            key={`${path.layer}-${path.color}-${index}`}
            d={path.d}
            fill="none"
            stroke={path.color}
            vectorEffect="non-scaling-stroke"
          />
        ),
      )}
    </g>
  )
})

const Labels = memo(function Labels({ labels, view, size, hiddenKey }) {
  const hidden = new Set(hiddenKey ? hiddenKey.split('\n') : [])
  const box = visibleBounds(view, size, 200)
  const minSize = MIN_LABEL_PX / (view.scale || 1)

  const shown = labels.filter(
    (l) =>
      l.size >= minSize &&
      !hidden.has(l.layer) &&
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

export default function PlanView({
  plan,
  project,
  signs,
  selectedId,
  onSelectSign,
  addMode,
  onAddAt,
  viewport,
}) {
  const { containerRef, size, view, transform, handlers, toWorld, fitTo, wasDrag } = viewport
  const fittedFor = useRef(null)

  // Fit the drawing the first time we know both the plan and the viewport size.
  useEffect(() => {
    if (!project || !size.width || !size.height) return
    if (fittedFor.current === project.id) return
    fittedFor.current = project.id
    fitTo(project.bounds)
  }, [project, size.width, size.height, fitTo])

  const hiddenKey = (project?.layers ?? [])
    .filter((l) => !l.visible)
    .map((l) => l.name)
    .join('\n')

  return (
    <div
      ref={containerRef}
      className={`plan ${addMode ? 'plan--adding' : ''}`}
      {...handlers}
      onClick={(event) => {
        if (!addMode || wasDrag()) return
        const point = toWorld(event.clientX, event.clientY)
        onAddAt(point.x, point.y)
      }}
    >
      <svg className="plan__svg" width="100%" height="100%" role="presentation">
        <g transform={transform}>
          {plan?.paths?.length ? <LayerPaths paths={plan.paths} hiddenKey={hiddenKey} /> : null}
          {project?.showLabels && plan?.labels?.length ? (
            <Labels labels={plan.labels} view={view} size={size} hiddenKey={hiddenKey} />
          ) : null}
          <SignMarkers
            signs={signs}
            view={view}
            size={size}
            selectedId={selectedId}
            onSelect={(id) => {
              if (!wasDrag()) onSelectSign(id)
            }}
          />
        </g>
      </svg>
    </div>
  )
}
