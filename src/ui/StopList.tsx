import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { routesAtStop } from '../model/types'

/**
 * Every stop in the import, which is the unit of work here: a route has one
 * timetable, but each of its shelters needs its own sheet.
 */
export const StopList = ({ overflowing }: { overflowing: Set<string> }) => {
  const stops = useStore((s) => s.project.timetable.stops)
  const timetable = useStore((s) => s.project.timetable)
  const edits = useStore((s) => s.project.edits)
  const selected = useStore((s) => s.selection.stopId)
  const select = useStore((s) => s.select)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return stops
    return stops.filter((s) => s.name.toLowerCase().includes(q) || (s.code ?? '').toLowerCase().includes(q))
  }, [stops, query])

  return (
    <aside className="sidebar">
      <header className="sidebar-head">
        <h2>Stops</h2>
        <span className="count">{stops.length}</span>
      </header>

      <input
        className="search"
        type="search"
        placeholder="Search stops"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {overflowing.size > 0 ? (
        <p className="sidebar-warning">
          {overflowing.size} {overflowing.size === 1 ? 'sheet does' : 'sheets do'} not fit at the smallest
          allowed size.
        </p>
      ) : null}

      <ul className="stop-list">
        {filtered.map((stop) => {
          const routes = routesAtStop(timetable, stop.id)
          const edited = Boolean(edits[stop.id] && Object.keys(edits[stop.id]!).length > 0)
          return (
            <li key={stop.id}>
              <button
                className={`stop${selected === stop.id ? ' is-selected' : ''}`}
                onClick={() => select(stop.id)}
              >
                <span className="stop-name">
                  {stop.name}
                  {edited ? <em className="dot" title="Has edits of its own" /> : null}
                  {overflowing.has(stop.id) ? <em className="flag" title="Does not fit" /> : null}
                </span>
                <span className="stop-meta">
                  {stop.code ? <em>{stop.code}</em> : null}
                  {routes.map((r) => (
                    <em key={r.id} className="route-chip" style={r.color ? { background: r.color } : undefined}>
                      {r.number}
                    </em>
                  ))}
                </span>
              </button>
            </li>
          )
        })}
        {filtered.length === 0 ? <li className="empty-row">No stops match.</li> : null}
      </ul>
    </aside>
  )
}
