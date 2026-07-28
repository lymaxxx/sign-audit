import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { routesAtStop } from '../model/types'
import { ColorInput, Field, TextInput, Toggle } from './controls'

/**
 * The route roster, alongside the stops it serves.
 *
 * Colour, badge wording and the night-route flag all belong to the route
 * itself — set once here, they show up on every stop's sheet it appears on,
 * the same way a per-stop edit only ever touches the one sheet it was made on.
 */
export const RoutesList = () => {
  const routes = useStore((s) => s.project.timetable.routes)
  const stops = useStore((s) => s.project.timetable.stops)
  const timetable = useStore((s) => s.project.timetable)
  const updateRoute = useStore((s) => s.updateRoute)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return routes
    return routes.filter(
      (r) => r.number.toLowerCase().includes(q) || (r.terminal || '').toLowerCase().includes(q),
    )
  }, [routes, query])

  if (routes.length === 0) {
    return (
      <>
        <header className="sidebar-head">
          <h2>Routes</h2>
          <span className="count">0</span>
        </header>
        <p className="empty-row">Import a timetable to see its routes.</p>
      </>
    )
  }

  return (
    <>
      <header className="sidebar-head">
        <h2>Routes</h2>
        <span className="count">{routes.length}</span>
      </header>

      <input
        className="search"
        type="search"
        placeholder="Search routes"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <ul className="route-list">
        {filtered.map((route) => {
          const served = stops.filter((stop) => routesAtStop(timetable, stop.id).some((r) => r.id === route.id))
          return (
            <li key={route.id}>
              <details className="route-card">
                <summary>
                  <span className="route-card-number" style={route.color ? { background: route.color } : undefined}>
                    {route.displayLabel?.trim() || route.number}
                  </span>
                  <span className="route-card-dest">{route.terminal || 'No destination'}</span>
                  {route.isNightRoute ? <em className="flag" title="Night route" /> : null}
                </summary>

                <div className="route-card-body">
                  <Field label="Colour" hint={route.color ? undefined : 'unset — the accent is used instead'}>
                    <ColorInput
                      value={route.color ?? '#1f6feb'}
                      onChange={(v) => updateRoute(route.id, (r) => void (r.color = v))}
                    />
                  </Field>
                  <Field label="Badge label" hint={`printed instead of "${route.number}"`}>
                    <TextInput
                      value={route.displayLabel ?? ''}
                      placeholder={route.number}
                      onChange={(v) =>
                        updateRoute(route.id, (r) => {
                          if (v.trim()) r.displayLabel = v
                          else delete r.displayLabel
                        })
                      }
                    />
                  </Field>
                  <Field label="Destination">
                    <TextInput value={route.terminal} onChange={(v) => updateRoute(route.id, (r) => void (r.terminal = v))} />
                  </Field>
                  <Field label="Streets" hint="comma separated">
                    <TextInput
                      value={route.via.join(', ')}
                      onChange={(v) =>
                        updateRoute(route.id, (r) => {
                          r.via = v
                            .split(',')
                            .map((x) => x.trim())
                            .filter(Boolean)
                        })
                      }
                    />
                  </Field>
                  <Field label="Note" hint="printed under the block">
                    <TextInput
                      value={route.notes.join(' ')}
                      onChange={(v) => updateRoute(route.id, (r) => void (r.notes = v ? [v] : []))}
                    />
                  </Field>
                  <Toggle
                    label="Night route — list separately at the foot of the sheet"
                    value={Boolean(route.isNightRoute)}
                    onChange={(v) =>
                      updateRoute(route.id, (r) => {
                        if (v) r.isNightRoute = true
                        else delete r.isNightRoute
                      })
                    }
                  />
                  <p className="readout">
                    Calls at {served.length} of {stops.length} stops.
                  </p>
                </div>
              </details>
            </li>
          )
        })}
        {filtered.length === 0 ? <li className="empty-row">No routes match.</li> : null}
      </ul>
    </>
  )
}
