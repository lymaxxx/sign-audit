import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { buildNetworkGraph } from './graph.js'
import { bestLayoutIterator } from './layout.js'
import { buildSchematic } from './build.js'
import { centroidOfPositions, rotatePoint, rotatePositions } from './geometry.js'

// Runs the layout optimiser in animation-frame slices so the UI keeps
// breathing while a big network settles.
function useSchematicLayout(project, nonce) {
  const graph = useMemo(() => buildNetworkGraph(project), [project.stops, project.routes])
  const [positions, setPositions] = useState(null)
  const [progress, setProgress] = useState(null)
  const s = project.schematic

  const layoutKey = `${nonce}|${s.angleStep}|${s.iterations}|${s.edgeLength}|${s.strictness}|${s.seed}`

  useEffect(() => {
    if (graph.empty) {
      setPositions(null)
      setProgress(null)
      return undefined
    }
    let cancelled = false
    const it = bestLayoutIterator(graph, {
      angleStep: s.angleStep,
      iterations: s.iterations,
      edgeLength: s.edgeLength,
      strictness: s.strictness,
      seed: s.seed,
      overrides: project.overrides,
    })
    setProgress({ iteration: 0, iterations: s.iterations })

    const tick = () => {
      if (cancelled) return
      const start = performance.now()
      let step = it.next()
      while (!step.done && performance.now() - start < 24) step = it.next()
      if (step.done) {
        setPositions(step.value.positions)
        setProgress(null)
        return
      }
      setProgress(step.value)
      requestAnimationFrame(tick)
    }
    const handle = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      cancelAnimationFrame(handle)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, layoutKey])

  return { graph, positions, setPositions, progress }
}

export default function SchematicView({ project, dispatch, onSelectStop }) {
  const [nonce, setNonce] = useState(0)
  const { graph, positions, setPositions, progress } = useSchematicLayout(project, nonce)
  const s = project.schematic
  const containerRef = useRef(null)
  const contentRef = useRef(null)
  const [view, setView] = useState({ tx: 0, ty: 0, k: 1 })
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [drag, setDrag] = useState(null)
  const [hovered, setHovered] = useState(null)

  // `positions` (from the solver + manual overrides) is always canonical and
  // unrotated — rotation is a pure display transform derived from it, so
  // overrides stay meaningful even if the rotation is changed later.
  const displayPositions = useMemo(
    () => (positions ? rotatePositions(positions, s.rotation) : positions),
    [positions, s.rotation],
  )

  const model = useMemo(() => {
    if (!displayPositions || graph.empty) return null
    // `positions` can briefly lag behind a `graph` that just changed shape —
    // a stop added, deleted, split or merged — while the solver effect below
    // is still catching up. Treat that the same as "not ready yet" (the
    // loading UI covers it) instead of crashing on a missing entry.
    for (const node of graph.nodes) {
      if (!displayPositions.has(node.stopId)) return null
    }
    return buildSchematic(project, graph, displayPositions, s)
  }, [displayPositions, graph, project, s])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return undefined
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const fit = useCallback(() => {
    if (!model || !size.w) return
    const b = model.bounds
    const legendW = legendWidth(model, s)
    const k = Math.min(size.w / (b.width + legendW), size.h / b.height) * 0.94
    setView({
      k,
      tx: size.w / 2 - (b.minX + (b.width + legendW) / 2) * k,
      ty: size.h / 2 - (b.minY + b.height / 2) * k,
    })
  }, [model, size, s])

  const fittedFor = useRef(null)
  useEffect(() => {
    if (!model) return
    const key = `${model.bounds.width}x${model.bounds.height}`
    if (fittedFor.current === key) return
    fittedFor.current = key
    fit()
  }, [model, fit])

  const onWheel = (e) => {
    e.preventDefault()
    const rect = containerRef.current.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const factor = Math.exp(-e.deltaY * 0.0015)
    setView((v) => {
      const k = Math.max(0.05, Math.min(12, v.k * factor))
      return { k, tx: mx - ((mx - v.tx) * k) / v.k, ty: my - ((my - v.ty) * k) / v.k }
    })
  }

  const toWorld = (clientX, clientY) => {
    const rect = containerRef.current.getBoundingClientRect()
    return {
      x: (clientX - rect.left - view.tx) / view.k,
      y: (clientY - rect.top - view.ty) / view.k,
    }
  }

  const onPointerDown = (e) => {
    if (e.button !== 0) return
    containerRef.current.setPointerCapture(e.pointerId)
    setDrag({ mode: 'pan', x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty })
  }

  const onMarkerPointerDown = (e, marker) => {
    e.stopPropagation()
    containerRef.current.setPointerCapture(e.pointerId)
    const world = toWorld(e.clientX, e.clientY)
    setDrag({
      mode: 'node',
      stopId: marker.stopId,
      dx: world.x - marker.centerX,
      dy: world.y - marker.centerY,
      // the centroid used to derive display positions from canonical ones,
      // fixed for the whole drag so the inverse rotation stays consistent
      center: centroidOfPositions(positions),
    })
    onSelectStop?.(marker.stopId)
  }

  const onPointerMove = (e) => {
    if (!drag) return
    if (drag.mode === 'pan') {
      setView((v) => ({ ...v, tx: drag.tx + (e.clientX - drag.x), ty: drag.ty + (e.clientY - drag.y) }))
      return
    }
    const world = toWorld(e.clientX, e.clientY)
    // The pointer and the marker it's dragging both live in display (rotated)
    // space; snap on-screen, then rotate back into the canonical space that
    // `positions` and overrides are stored in.
    let x = world.x - drag.dx
    let y = world.y - drag.dy
    if (!e.shiftKey) {
      const grid = s.edgeLength / 4
      x = Math.round(x / grid) * grid
      y = Math.round(y / grid) * grid
    }
    const canonical = s.rotation ? rotatePoint({ x, y }, drag.center, -s.rotation) : { x, y }
    setPositions((prev) => {
      if (!prev) return prev
      const next = new Map(prev)
      next.set(drag.stopId, canonical)
      return next
    })
    setDrag({ ...drag, lastX: canonical.x, lastY: canonical.y })
  }

  const onPointerUp = () => {
    if (drag?.mode === 'node' && drag.lastX !== undefined) {
      dispatch({ type: 'setOverride', stopId: drag.stopId, pos: [drag.lastX, drag.lastY] })
    }
    setDrag(null)
  }

  const exportSvg = () => {
    const svg = buildStandaloneSvg(contentRef.current, model, s)
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${slug(project.name)}-schematic.svg`)
  }

  const exportPng = () => {
    const svg = buildStandaloneSvg(contentRef.current, model, s)
    const scale = 2
    const b = model.bounds
    const legendW = legendWidth(model, s)
    const img = new Image()
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = (b.width + legendW) * scale
      canvas.height = b.height * scale
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = s.background
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => {
        downloadBlob(blob, `${slug(project.name)}-schematic.png`)
        URL.revokeObjectURL(url)
      })
    }
    img.src = url
  }

  const empty = graph.empty || !model

  return (
    <div className="schematic-wrap">
      <div className="schematic-toolbar">
        <button onClick={() => setNonce((n) => n + 1)} title="Run the layout solver again">
          ↻ Regenerate
        </button>
        <button
          onClick={() => {
            dispatch({ type: 'setSchematic', patch: { seed: Math.floor(Math.random() * 9999) + 1 } })
          }}
          title="Try a different starting shuffle"
        >
          🎲 New variation
        </button>
        <button onClick={fit}>⤢ Fit</button>
        <button
          onClick={() => dispatch({ type: 'clearOverrides' })}
          disabled={!Object.keys(project.overrides).length}
          title="Forget manually dragged stations"
        >
          Reset dragged stops ({Object.keys(project.overrides).length})
        </button>
        <span className="spacer" />
        <button onClick={exportSvg} disabled={empty}>
          ⬇ SVG
        </button>
        <button onClick={exportPng} disabled={empty}>
          ⬇ PNG
        </button>
      </div>

      <div
        ref={containerRef}
        className="schematic-canvas"
        style={{ background: s.background, cursor: drag ? 'grabbing' : 'grab' }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {empty ? (
          <div className="empty-note">
            <h3>Nothing to draw yet</h3>
            <p>
              Load stops from OpenStreetMap and add at least one route with two stops, then come
              back here.
            </p>
          </div>
        ) : (
          <svg width={size.w} height={size.h}>
            <g ref={contentRef} transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
              <SchematicContent
                model={model}
                settings={s}
                hovered={hovered}
                onMarkerPointerDown={onMarkerPointerDown}
                onMarkerHover={setHovered}
              />
            </g>
          </svg>
        )}

        {progress && (
          <div className="layout-progress">
            Generating schematic…{' '}
            {progress.attempts > 1
              ? `variant ${progress.attempt}/${progress.attempts} · ${progress.iteration}/${progress.iterations}`
              : `${progress.iteration}/${progress.iterations}`}
          </div>
        )}
        <div className="schematic-hint">
          Scroll to zoom · drag background to pan · drag a station to place it by hand (hold Shift
          for free positioning)
        </div>
      </div>
    </div>
  )
}

function SchematicContent({ model, settings: s, hovered, onMarkerPointerDown, onMarkerHover }) {
  return (
    <>
      {s.roads?.show && model.roads.length > 0 && (
        <g className="roads">
          {model.roads.map((r) => (
            <line
              key={r.key}
              x1={r.a.x}
              y1={r.a.y}
              x2={r.b.x}
              y2={r.b.y}
              stroke={s.roads.color}
              strokeWidth={s.roads.width}
              strokeOpacity={s.roads.opacity}
              strokeLinecap="round"
            />
          ))}
        </g>
      )}

      {s.casing && (
        <g className="casings">
          {model.routes.flatMap((route) =>
            route.paths.map((p) => (
              <path
                key={`c-${p.key}`}
                d={p.d}
                fill="none"
                stroke={s.background}
                strokeWidth={s.lineWidth + s.casingWidth * 2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )),
          )}
        </g>
      )}

      <g className="lines">
        {model.routes.flatMap((route) =>
          route.paths.map((p) => (
            <path
              key={p.key}
              d={p.d}
              fill="none"
              stroke={route.color}
              strokeOpacity={s.lineOpacity}
              strokeWidth={s.lineWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )),
        )}
      </g>

      {s.arrows.show && (
        <g className="arrows">
          {model.arrows.map((a) => (
            <polygon
              key={a.key}
              points={arrowPoints(s.arrows.size)}
              fill={s.background}
              stroke={a.color}
              strokeWidth={1}
              transform={`translate(${a.x} ${a.y}) rotate(${a.angle})`}
            />
          ))}
        </g>
      )}

      <g className="stops">
        {model.markers.map((m) => (
          <StopMarker
            key={m.stopId}
            marker={m}
            settings={s}
            highlighted={hovered === m.stopId}
            onPointerDown={(e) => onMarkerPointerDown(e, m)}
            onPointerEnter={() => onMarkerHover(m.stopId)}
            onPointerLeave={() => onMarkerHover(null)}
          />
        ))}
      </g>

      {s.badges.show && (
        <g className="badges">
          {model.routes.flatMap((route) =>
            route.badges.map((b) => (
              <g key={`b-${b.key}`} transform={`translate(${b.x} ${b.y})`}>
                <rect
                  x={-s.badges.size * (0.5 + route.number.length * 0.34)}
                  y={-s.badges.size * 0.72}
                  width={s.badges.size * (1 + route.number.length * 0.68)}
                  height={s.badges.size * 1.44}
                  rx={s.badges.size * 0.45}
                  fill={route.color}
                  stroke={s.background}
                  strokeWidth={1.5}
                />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={s.badges.size}
                  fontWeight="700"
                  fill="#fff"
                  fontFamily="Inter, system-ui, sans-serif"
                >
                  {route.number}
                </text>
              </g>
            )),
          )}
        </g>
      )}

      {s.labels.show && (
        <g className="labels">
          {model.labels.map((l) => (
            <text
              key={l.stopId}
              x={l.x}
              y={l.y}
              textAnchor={l.anchor}
              dominantBaseline="central"
              fontSize={s.labels.size}
              fontWeight={l.bold ? 700 : 500}
              fill={s.labels.color}
              stroke={s.labels.halo}
              strokeWidth={s.labels.haloWidth}
              paintOrder="stroke"
              strokeLinejoin="round"
              fontFamily="Inter, system-ui, sans-serif"
              transform={s.labels.angle ? `rotate(${s.labels.angle} ${l.x} ${l.y})` : undefined}
            >
              {l.text}
            </text>
          ))}
        </g>
      )}

      {s.legend.show && <Legend model={model} settings={s} />}
    </>
  )
}

function Legend({ model, settings: s }) {
  const x = model.bounds.maxX + 24
  const y = model.bounds.minY + 40
  const rowH = s.legend.size * 2
  return (
    <g className="legend">
      <text
        x={x}
        y={y - rowH * 0.8}
        fontSize={s.legend.size * 1.2}
        fontWeight="700"
        fill={s.labels.color}
        fontFamily="Inter, system-ui, sans-serif"
      >
        Routes
      </text>
      {model.routes.map((route, i) => (
        <g key={route.id} transform={`translate(${x} ${y + i * rowH})`}>
          <rect y={-s.legend.size * 0.45} width={s.legend.size * 2.2} height={s.legend.size * 0.9} rx={s.legend.size * 0.45} fill={route.color} />
          <text
            x={s.legend.size * 2.8}
            dominantBaseline="central"
            fontSize={s.legend.size}
            fill={s.labels.color}
            fontFamily="Inter, system-ui, sans-serif"
          >
            <tspan fontWeight="700">{route.number}</tspan>
            <tspan dx={s.legend.size * 0.5}>{route.name}</tspan>
          </text>
        </g>
      ))}
    </g>
  )
}

function StopMarker({ marker: m, settings: s, highlighted, ...handlers }) {
  const cfg = m.isInterchange ? s.interchangeStop : s.regularStop
  const stroke = cfg.useRouteColor ? m.colors[0] || cfg.stroke : cfg.stroke
  const common = {
    ...handlers,
    style: { cursor: 'move' },
  }
  const r = cfg.size
  const shape = cfg.shape

  let node = null
  if (!m.isInterchange && shape === 'none') node = null
  else if (!m.isInterchange && shape === 'tick') {
    // A blunt stub from the stop out toward wherever its label ended up —
    // not a hash mark crossing the line both ways — rotated relative to the
    // outer (corridor-angle) group so it ends up pointing at the absolute
    // tickAngle regardless of which way the corridor itself runs.
    node = (
      <g transform={`rotate(${(m.tickAngle ?? 0) - m.angle})`}>
        <line x1={0} y1={0} x2={r * 2} y2={0} stroke={stroke} strokeWidth={cfg.strokeWidth} strokeLinecap="butt" />
      </g>
    )
  } else if (shape === 'capsule') {
    const t = r * 0.75
    node = (
      <rect
        x={-t}
        y={-(m.span / 2 + t)}
        width={t * 2}
        height={m.span + t * 2}
        rx={t}
        fill={cfg.color}
        stroke={stroke}
        strokeWidth={cfg.strokeWidth}
      />
    )
  } else if (shape === 'square') {
    node = (
      <rect
        x={-r}
        y={-r}
        width={r * 2}
        height={r * 2}
        rx={r * 0.25}
        fill={cfg.color}
        stroke={stroke}
        strokeWidth={cfg.strokeWidth}
      />
    )
  } else if (shape === 'ring') {
    node = (
      <>
        <circle r={r} fill={cfg.color} stroke={stroke} strokeWidth={cfg.strokeWidth} />
        <circle r={Math.max(1, r * 0.35)} fill={stroke} />
      </>
    )
  } else {
    node = <circle r={r} fill={cfg.color} stroke={stroke} strokeWidth={cfg.strokeWidth} />
  }

  return (
    <g transform={`translate(${m.x} ${m.y}) rotate(${m.angle})`} {...common}>
      {highlighted && <circle r={r + 6} fill="none" stroke="#2b6cff" strokeWidth={2} opacity={0.8} />}
      <circle r={Math.max(r, 10)} fill="transparent" />
      {node}
      {s.stopArrows.show && <ServiceArrows marker={m} settings={s} radius={r} />}
    </g>
  )
}

// A stop that a route only calls at in one direction keeps its place on the
// single bidirectional line; the fact that it's served one way only shows up
// here, as a small arrow beside the marker pointing the way the vehicle goes.
function ServiceArrows({ marker: m, settings: s, radius }) {
  const arrows = m.oneWayAnchors || []
  if (!arrows.length) return null
  const size = s.stopArrows.size
  // Sit out along the tick, between the marker and its label. That direction
  // is chosen to point away from the corridor, so unlike a plain perpendicular
  // offset it can't land back on the line at a stop that falls on a corner —
  // and the space is already kept clear for the label.
  const reach = Math.max(radius * 2, radius + m.span / 2) + size * 1.3
  return arrows.map((a, i) => {
    const flip = a.serves === 'bwd' ? 180 : 0
    const along = i * size * 2.2 // only matters when several routes are one-way here
    return (
      <g
        key={`${a.routeId}-${i}`}
        transform={`rotate(${(m.tickAngle ?? 0) - m.angle}) translate(${reach + along} 0) rotate(${
          a.angle - (m.tickAngle ?? 0) + flip
        })`}
      >
        <polygon
          points={arrowPoints(size)}
          fill={s.stopArrows.useRouteColor ? a.color || s.stopArrows.color : s.stopArrows.color}
          stroke="#fff"
          strokeWidth={1}
          strokeLinejoin="round"
        />
      </g>
    )
  })
}

function arrowPoints(size) {
  return `${size},0 ${-size * 0.55},${size * 0.62} ${-size * 0.55},${-size * 0.62}`
}

// Reserve room to the right of the diagram for the route key.
function legendWidth(model, s) {
  if (!s.legend.show) return 0
  const longest = model.routes.reduce(
    (max, r) => Math.max(max, `${r.number} ${r.name}`.length),
    0,
  )
  return 40 + s.legend.size * (3 + longest * 0.56)
}

function buildStandaloneSvg(contentEl, model, s) {
  const clone = contentEl.cloneNode(true)
  clone.removeAttribute('transform')
  const b = model.bounds
  const legendW = legendWidth(model, s)
  const serialized = new XMLSerializer().serializeToString(clone)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(b.width + legendW)}" height="${Math.round(b.height)}" viewBox="${b.minX} ${b.minY} ${b.width + legendW} ${b.height}">
<rect x="${b.minX}" y="${b.minY}" width="${b.width + legendW}" height="${b.height}" fill="${s.background}"/>
${serialized}
</svg>`
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

function slug(name) {
  return (name || 'network').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
