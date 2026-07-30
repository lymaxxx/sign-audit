import { useRef, useState } from 'react'
import { evenlySpace } from '../dxf/detectSigns.js'

/**
 * How many faces a sign has, and which way each one looks.
 *
 * This is manual on purpose. Drawings state side count in whatever way each
 * draughtsman preferred — a letter inside a block here, loose text around a
 * circle there — and getting it wrong is expensive in a quiet way: the auditor
 * gets the wrong number of photo slots and only finds out standing in front of
 * the sign. The person on site knows the answer for certain, so they set it.
 *
 * Bearings are degrees in the drawing's frame, matching DXF convention:
 * 0 points along +X, increasing counter-clockwise.
 */

const MAX_SIDES = 4
const LABELS = ['A', 'B', 'C', 'D']
const DIAL = 46
const NUDGE = 15

export default function SidesEditor({ sides, onChange }) {
  const list = sides?.length ? sides : [{ id: 'A', bearing: 0 }]
  const svgRef = useRef(null)
  const [dragIndex, setDragIndex] = useState(null)

  const setCount = (count) => {
    if (count === list.length) return
    if (count < list.length) {
      onChange(list.slice(0, count))
      return
    }
    const added = []
    for (let i = list.length; i < count; i++) {
      added.push({ id: LABELS[i] ?? String(i + 1), bearing: 0 })
    }
    // A new face with no bearing is meaningless, so spread them all out and let
    // the user nudge from there.
    onChange(evenlySpace([...list, ...added]))
  }

  const setSide = (index, patch) =>
    onChange(list.map((side, i) => (i === index ? { ...side, ...patch } : side)))

  const nudge = (index, delta) =>
    setSide(index, { bearing: (((list[index].bearing ?? 0) + delta) % 360 + 360) % 360 })

  // Convert a pointer event to a bearing by mapping it into the dial's own SVG
  // user space (via its screen CTM) rather than trusting the container's CSS
  // box — the dial can be scaled by layout, and this stays correct regardless.
  const bearingAt = (event) => {
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    if (!ctm) return null
    const point = svg.createSVGPoint()
    point.x = event.clientX
    point.y = event.clientY
    const local = point.matrixTransform(ctm.inverse())
    // Screen space has Y down; the dial's own bearing convention (see render
    // below) negates that back out, so undo it the same way here.
    const screenAngle = Math.atan2(local.y, local.x)
    return (((-screenAngle * 180) / Math.PI) % 360 + 360) % 360
  }

  const startDrag = (index) => (event) => {
    event.preventDefault()
    svgRef.current?.setPointerCapture?.(event.pointerId)
    setDragIndex(index)
    const bearing = bearingAt(event)
    if (bearing != null) setSide(index, { bearing })
  }

  const dragMove = (event) => {
    if (dragIndex === null) return
    const bearing = bearingAt(event)
    if (bearing != null) setSide(dragIndex, { bearing })
  }

  const endDrag = (event) => {
    if (dragIndex === null) return
    svgRef.current?.releasePointerCapture?.(event.pointerId)
    setDragIndex(null)
  }

  return (
    <div className="field">
      <span>Sides</span>

      <div className="segmented segmented--count" role="group" aria-label="Number of sides">
        {Array.from({ length: MAX_SIDES }, (_, i) => i + 1).map((count) => (
          <button
            key={count}
            type="button"
            className={list.length === count ? 'segmented__item is-on' : 'segmented__item'}
            onClick={() => setCount(count)}
          >
            {count}
          </button>
        ))}
      </div>

      <div className="sides">
        <svg
          ref={svgRef}
          className="sides__dial"
          viewBox="-60 -60 120 120"
          role="presentation"
          onPointerMove={dragMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <circle r={DIAL} fill="none" stroke="var(--line)" strokeWidth={1} />
          {list.map((side, index) => {
            // Negated: the dial is drawn in screen space, where Y runs down.
            const angle = (-side.bearing * Math.PI) / 180
            const hx = Math.cos(angle) * DIAL
            const hy = Math.sin(angle) * DIAL
            return (
              <g key={side.id ?? index}>
                <line x1={0} y1={0} x2={hx} y2={hy} stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" />
                {/* Fat, invisible hit area — the visible line is too thin to
                    grab reliably with a fingertip. */}
                <line
                  x1={0}
                  y1={0}
                  x2={hx}
                  y2={hy}
                  stroke="transparent"
                  strokeWidth={16}
                  strokeLinecap="round"
                  style={{ cursor: 'grab', touchAction: 'none' }}
                  onPointerDown={startDrag(index)}
                />
                <text
                  x={Math.cos(angle) * (DIAL - 14)}
                  y={Math.sin(angle) * (DIAL - 14)}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={13}
                  fill="var(--ink)"
                  style={{ pointerEvents: 'none' }}
                >
                  {side.id}
                </text>
                <circle
                  cx={hx}
                  cy={hy}
                  r={9}
                  fill="var(--accent)"
                  stroke="var(--surface)"
                  strokeWidth={2}
                  style={{ cursor: 'grab', touchAction: 'none' }}
                  onPointerDown={startDrag(index)}
                />
              </g>
            )
          })}
        </svg>

        <ul className="sides__list">
          {list.map((side, index) => (
            <li key={index}>
              <input
                className="sides__label"
                value={side.id ?? ''}
                aria-label={`Side ${index + 1} label`}
                maxLength={4}
                onChange={(event) => setSide(index, { id: event.target.value.toUpperCase() })}
              />
              <button
                type="button"
                className="ghost sides__step"
                aria-label={`Rotate side ${side.id} 15 degrees clockwise`}
                onClick={() => nudge(index, -NUDGE)}
              >
                −
              </button>
              <input
                className="sides__bearing"
                type="number"
                inputMode="numeric"
                step={5}
                value={Math.round(side.bearing ?? 0)}
                aria-label={`Side ${side.id} bearing in degrees`}
                onChange={(event) =>
                  setSide(index, {
                    bearing: (((Number(event.target.value) || 0) % 360) + 360) % 360,
                  })
                }
              />
              <span className="sides__unit">°</span>
              <button
                type="button"
                className="ghost sides__step"
                aria-label={`Rotate side ${side.id} 15 degrees counter-clockwise`}
                onClick={() => nudge(index, NUDGE)}
              >
                +
              </button>
            </li>
          ))}
        </ul>
      </div>

      {list.length > 1 && (
        <button type="button" className="ghost sides__even" onClick={() => onChange(evenlySpace(list))}>
          Space evenly
        </button>
      )}
    </div>
  )
}
