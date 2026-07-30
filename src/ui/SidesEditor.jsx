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

export default function SidesEditor({ sides, onChange }) {
  const list = sides?.length ? sides : [{ id: 'A', bearing: 0 }]

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
        <svg className="sides__dial" viewBox="-60 -60 120 120" role="presentation">
          <circle r={DIAL} fill="none" stroke="var(--line)" strokeWidth={1} />
          {list.map((side, index) => {
            // Negated: the dial is drawn in screen space, where Y runs down.
            const angle = (-side.bearing * Math.PI) / 180
            return (
              <g key={side.id ?? index}>
                <line
                  x1={0}
                  y1={0}
                  x2={Math.cos(angle) * DIAL}
                  y2={Math.sin(angle) * DIAL}
                  stroke="var(--accent)"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
                <text
                  x={Math.cos(angle) * (DIAL - 14)}
                  y={Math.sin(angle) * (DIAL - 14)}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={13}
                  fill="var(--ink)"
                >
                  {side.id}
                </text>
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
