import { STATUS, STATUS_ORDER } from '../util/status.js'

/**
 * Type and status filters for the sign list.
 *
 * Types are the prefix before the first underscore in a sign's name, derived
 * from whatever is actually on the plan rather than a fixed list.
 */

function toggle(set, value) {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

export default function Filters({ filters, onChange, types, counts }) {
  const set = (patch) => onChange({ ...filters, ...patch })

  return (
    <div className="filters">
      <input
        className="filters__search"
        type="search"
        inputMode="search"
        placeholder="Search signs…"
        value={filters.query}
        onChange={(event) => set({ query: event.target.value })}
      />

      <div className="chips" role="group" aria-label="Filter by status">
        {STATUS_ORDER.map((key) => {
          const on = filters.statuses.has(key)
          return (
            <button
              key={key}
              type="button"
              className={on ? 'chip is-on' : 'chip'}
              style={{ '--accent': STATUS[key].color }}
              onClick={() => set({ statuses: toggle(filters.statuses, key) })}
            >
              <span className="chip__dot" />
              {STATUS[key].short}
              <span className="chip__count">{counts.status[key] ?? 0}</span>
            </button>
          )
        })}
      </div>

      {types.length > 1 && (
        <div className="chips" role="group" aria-label="Filter by type">
          {types.map((type) => {
            const on = filters.types.has(type)
            return (
              <button
                key={type}
                type="button"
                className={on ? 'chip is-on' : 'chip'}
                onClick={() => set({ types: toggle(filters.types, type) })}
              >
                {type}
                <span className="chip__count">{counts.type[type] ?? 0}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className="filters__foot">
        <label className="filters__sort">
          Sort
          <select value={filters.sort} onChange={(event) => set({ sort: event.target.value })}>
            <option value="name">Name</option>
            <option value="type">Type, then name</option>
            <option value="status">Status</option>
            <option value="updated">Recently updated</option>
          </select>
        </label>
        {(filters.types.size > 0 || filters.statuses.size > 0 || filters.query) && (
          <button
            type="button"
            className="ghost"
            onClick={() => set({ types: new Set(), statuses: new Set(), query: '' })}
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  )
}
