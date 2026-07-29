import { memo } from 'react'
import { STATUS, statusOf } from '../util/status.js'

/**
 * Flat, filterable index of every sign.
 *
 * Rows can be ticked or flagged without opening the panel, because most of an
 * audit is confirming that things are as drawn. Tapping the row itself opens
 * the panel and moves the plan to that sign.
 */

const Row = memo(function Row({ sign, selected, onOpen, onSetStatus }) {
  const status = statusOf(sign.status)
  const photos = (sign.photos?.A?.length ?? 0) + (sign.photos?.B?.length ?? 0)

  return (
    <li className={selected ? 'row is-selected' : 'row'}>
      <button type="button" className="row__main" onClick={() => onOpen(sign.id)}>
        <span className="row__dot" style={{ background: status.color }} />
        <span className="row__text">
          <span className="row__name">{sign.name}</span>
          <span className="row__sub">
            <span className="chip chip--type chip--mini">{sign.type}</span>
            <span>{status.label}</span>
            {photos > 0 && <span>· {photos} photo{photos === 1 ? '' : 's'}</span>}
            {sign.notes?.trim() && <span>· note</span>}
          </span>
        </span>
      </button>

      <div className="row__actions">
        <button
          type="button"
          className={sign.status === 'checked' ? 'tick is-on' : 'tick'}
          aria-label={sign.status === 'checked' ? 'Mark as not checked' : 'Mark as checked'}
          title="Checked"
          onClick={() => onSetStatus(sign, sign.status === 'checked' ? 'unchecked' : 'checked')}
        >
          ✓
        </button>
        <button
          type="button"
          className={sign.status === 'review' ? 'flag is-on' : 'flag'}
          aria-label={sign.status === 'review' ? 'Clear review flag' : 'Mark as needing review'}
          title="Needs review"
          onClick={() => onSetStatus(sign, sign.status === 'review' ? 'unchecked' : 'review')}
        >
          !
        </button>
      </div>
    </li>
  )
})

export default function SignList({ signs, total, selectedId, onOpen, onSetStatus }) {
  if (!signs.length) {
    return (
      <p className="empty">
        {total === 0
          ? 'No signs on this plan yet. Use “Add sign” to place one.'
          : 'No signs match these filters.'}
      </p>
    )
  }

  return (
    <ul className="list">
      {signs.map((sign) => (
        <Row
          key={sign.id}
          sign={sign}
          selected={sign.id === selectedId}
          onOpen={onOpen}
          onSetStatus={onSetStatus}
        />
      ))}
    </ul>
  )
}

/** Progress summary shown above the list. */
export function Progress({ signs }) {
  const done = signs.filter((s) => s.status === 'checked').length
  const review = signs.filter((s) => s.status === 'review').length
  const percent = signs.length ? Math.round((done / signs.length) * 100) : 0

  return (
    <div className="progress">
      <div className="progress__bar">
        <span style={{ width: `${percent}%`, background: STATUS.checked.color }} />
      </div>
      <p>
        <strong>
          {done} / {signs.length}
        </strong>{' '}
        checked
        {review > 0 && <span className="progress__review"> · {review} need review</span>}
      </p>
    </div>
  )
}
