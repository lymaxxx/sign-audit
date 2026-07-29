import { memo } from 'react'
import { visibleBounds } from './useViewport.js'
import { statusOf } from '../util/status.js'

/**
 * Interactive sign markers, drawn over the baked plan geometry.
 *
 * Markers live inside the flipped, zoomed root group, so each one carries a
 * counter-transform `scale(k, -k)` where k = 1/zoom. That keeps them a fixed
 * size on screen at any zoom and undoes the Y flip, so their labels are not
 * mirrored.
 */

// Marker geometry, in CSS pixels.
const HIT_RADIUS = 22
const BODY = 9
// Below this zoom there are too many signs on screen for names to be legible.
const NAME_VISIBLE_SCALE = 0.55

function Marker({ sign, k, selected, onSelect, showName }) {
  const status = statusOf(sign.status)
  const proposed = sign.status === 'proposed'

  return (
    <g
      transform={`translate(${sign.x} ${sign.y}) scale(${k} ${-k})`}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(sign.id, event)
      }}
      style={{ cursor: 'pointer' }}
    >
      {/* Invisible touch target: markers stay tappable at a 44px finger size
          even though the visible dot is much smaller. */}
      <circle r={HIT_RADIUS} fill="transparent" />
      {selected && <circle r={BODY + 7} fill="none" stroke="#ffffff" strokeWidth={2} />}
      <circle
        r={BODY}
        fill={proposed ? 'rgba(100, 210, 255, 0.25)' : status.color}
        stroke={proposed ? status.color : 'rgba(0, 0, 0, 0.55)'}
        strokeWidth={proposed ? 2 : 1.5}
        strokeDasharray={proposed ? '3 2.5' : undefined}
      />
      {sign.status === 'checked' && (
        <path
          d="M-4 0 L-1.2 3 L4.2 -3"
          fill="none"
          stroke="#04210b"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {sign.status === 'review' && (
        <path
          d="M0 -4.2 L0 1 M0 3.4 L0 3.5"
          stroke="#3a2600"
          strokeWidth={2.2}
          strokeLinecap="round"
        />
      )}
      {showName && (
        <text
          x={0}
          y={BODY + 15}
          textAnchor="middle"
          fontSize={12}
          fill="#e8ecf4"
          stroke="#12151c"
          strokeWidth={3}
          paintOrder="stroke"
          style={{ pointerEvents: 'none' }}
        >
          {sign.name}
        </text>
      )}
    </g>
  )
}

const MemoMarker = memo(Marker)

function SignMarkers({ signs, view, size, selectedId, onSelect }) {
  const k = 1 / (view.scale || 1)
  const box = visibleBounds(view, size, HIT_RADIUS * 2)

  // Culling matters once the plan is zoomed in, which is where an auditor
  // spends nearly all their time.
  const shown = box
    ? signs.filter((s) => s.x >= box.minX && s.x <= box.maxX && s.y >= box.minY && s.y <= box.maxY)
    : signs

  const showNames = view.scale >= NAME_VISIBLE_SCALE || shown.length <= 40

  return (
    <g>
      {shown.map((sign) => (
        <MemoMarker
          key={sign.id}
          sign={sign}
          k={k}
          selected={sign.id === selectedId}
          showName={showNames}
          onSelect={onSelect}
        />
      ))}
    </g>
  )
}

export default memo(SignMarkers)
