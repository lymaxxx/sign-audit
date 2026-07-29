import { useEffect, useState } from 'react'
import PhotoSlot from './PhotoSlot.jsx'
import { STATUS, STATUS_ORDER } from '../util/status.js'
import { useStore } from '../state/storeContext.js'

/**
 * The audit form for a single sign. Renders as a bottom sheet on iPhone and a
 * side panel on iPad, so the plan stays visible on the larger screen.
 *
 * There is no save button: every change is dispatched immediately and the
 * store autosaves. Field work should never lose data to a forgotten tap.
 */
export default function SignPanel({ sign, onClose, onLocate }) {
  const { actions, busy } = useStore()
  const [name, setName] = useState(sign.name)
  const [notes, setNotes] = useState(sign.notes ?? '')

  // Re-seed the local draft when a different sign is opened.
  useEffect(() => {
    setName(sign.name)
    setNotes(sign.notes ?? '')
  }, [sign.id, sign.name, sign.notes])

  const commitName = () => {
    const next = name.trim()
    if (!next || next === sign.name) {
      setName(sign.name)
      return
    }
    actions.updateSign(sign.id, { name: next })
  }

  return (
    <aside className="panel" aria-label={`Sign ${sign.name}`}>
      <header className="panel__head">
        <div className="panel__title">
          <span className="chip chip--type">{sign.type}</span>
          <h2>{sign.name}</h2>
        </div>
        <div className="panel__headActions">
          <button type="button" className="ghost" onClick={onLocate}>
            Locate
          </button>
          <button type="button" className="ghost" onClick={onClose} aria-label="Close panel">
            ✕
          </button>
        </div>
      </header>

      <div className="panel__body">
        <label className="field">
          <span>Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>

        <div className="field">
          <span>Status</span>
          <div className="segmented" role="group">
            {STATUS_ORDER.map((key) => (
              <button
                key={key}
                type="button"
                className={sign.status === key ? 'segmented__item is-on' : 'segmented__item'}
                style={sign.status === key ? { '--accent': STATUS[key].color } : undefined}
                onClick={() => actions.updateSign(sign.id, { status: key })}
              >
                {STATUS[key].label}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span>Notes</span>
          <textarea
            rows={4}
            value={notes}
            placeholder="Condition, mounting, discrepancies against the plan…"
            onChange={(event) => {
              setNotes(event.target.value)
              actions.updateSign(sign.id, { notes: event.target.value })
            }}
          />
        </label>

        <PhotoSlot
          side="A"
          photoIds={sign.photos?.A ?? []}
          disabled={!!busy}
          onAdd={(file) => actions.addPhoto(sign, 'A', file)}
          onRemove={(photoId) => actions.removePhoto(sign, 'A', photoId)}
        />
        <PhotoSlot
          side="B"
          photoIds={sign.photos?.B ?? []}
          disabled={!!busy}
          onAdd={(file) => actions.addPhoto(sign, 'B', file)}
          onRemove={(photoId) => actions.removePhoto(sign, 'B', photoId)}
        />

        <dl className="meta">
          <div>
            <dt>Source</dt>
            <dd>{sign.source === 'added' ? 'Added on site' : `CAD block ${sign.blockName ?? ''}`}</dd>
          </div>
          {sign.layer && (
            <div>
              <dt>Layer</dt>
              <dd>{sign.layer}</dd>
            </div>
          )}
          <div>
            <dt>Position</dt>
            <dd>
              {sign.x.toFixed(2)}, {sign.y.toFixed(2)}
            </dd>
          </div>
        </dl>

        {sign.source === 'added' && (
          <button
            type="button"
            className="danger"
            onClick={() => {
              if (confirm(`Delete ${sign.name}? Its notes and photos go with it.`)) {
                actions.removeSign(sign.id, sign)
                onClose()
              }
            }}
          >
            Delete this sign
          </button>
        )}
      </div>
    </aside>
  )
}
