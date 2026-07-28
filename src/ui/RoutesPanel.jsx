import { Field, Section, Toggle } from './controls.jsx'
import { makeRoute, PALETTE, stopById } from '../state/project.js'
import { formatDistance, polylineLength } from '../lib/geo.js'

export default function RoutesPanel({
  project,
  dispatch,
  editing,
  setEditing,
  selectedRouteId,
  setSelectedRouteId,
  setFocus,
  insertAt,
  setInsertAt,
}) {
  const route = project.routes.find((r) => r.id === selectedRouteId) || null

  const addRoute = () => {
    const r = makeRoute(project.routes.length)
    dispatch({ type: 'addRoute', route: r })
    setSelectedRouteId(r.id)
    setEditing({ routeId: r.id, dirKey: 'fwd' })
  }

  return (
    <>
      <Section
        title={`Routes (${project.routes.length})`}
        right={
          <button className="primary small" onClick={addRoute}>
            + New route
          </button>
        }
      >
        {!project.routes.length && (
          <p className="muted small">
            Add a route, then click its stops on the map in order. The app follows the roads
            between them.
          </p>
        )}
        <ul className="route-list">
          {project.routes.map((r, i) => (
            <li
              key={r.id}
              className={r.id === selectedRouteId ? 'selected' : ''}
              onClick={() => setSelectedRouteId(r.id)}
            >
              <span className="swatch" style={{ background: r.color }} />
              <span className="num">{r.number}</span>
              <span className="name">{r.name}</span>
              <span className="muted small">
                {r.dirs.fwd.stopIds.length}
                {r.dirs.bwd ? ` / ${r.dirs.bwd.stopIds.length}` : ''}
              </span>
              <button
                className="icon"
                title={r.visible === false ? 'Show' : 'Hide'}
                onClick={(e) => {
                  e.stopPropagation()
                  dispatch({ type: 'updateRoute', id: r.id, patch: { visible: r.visible === false } })
                }}
              >
                {r.visible === false ? '◌' : '●'}
              </button>
              <button
                className="icon"
                title="Move up"
                disabled={i === 0}
                onClick={(e) => {
                  e.stopPropagation()
                  dispatch({ type: 'moveRoute', id: r.id, delta: -1 })
                }}
              >
                ↑
              </button>
              <button
                className="icon"
                title="Move down"
                disabled={i === project.routes.length - 1}
                onClick={(e) => {
                  e.stopPropagation()
                  dispatch({ type: 'moveRoute', id: r.id, delta: 1 })
                }}
              >
                ↓
              </button>
              <button
                className="icon"
                title="Delete route"
                onClick={(e) => {
                  e.stopPropagation()
                  if (!confirm(`Delete route ${r.number}?`)) return
                  dispatch({ type: 'deleteRoute', id: r.id })
                  if (editing?.routeId === r.id) setEditing(null)
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </Section>

      {route && (
        <RouteEditor
          key={route.id}
          project={project}
          dispatch={dispatch}
          route={route}
          editing={editing}
          setEditing={setEditing}
          setFocus={setFocus}
          insertAt={insertAt}
          setInsertAt={setInsertAt}
        />
      )}
    </>
  )
}

function RouteEditor({ project, dispatch, route, editing, setEditing, setFocus, insertAt, setInsertAt }) {
  const patch = (p) => dispatch({ type: 'updateRoute', id: route.id, patch: p })
  const activeDirKey = editing?.routeId === route.id ? editing.dirKey : null

  return (
    <Section title={`Route ${route.number} — ${route.name}`}>
      <div className="grid-2">
        <Field label="Number">
          <input value={route.number} onChange={(e) => patch({ number: e.target.value })} />
        </Field>
        <Field label="Mode">
          <select value={route.mode} onChange={(e) => patch({ mode: e.target.value })}>
            <option value="bus">Bus</option>
            <option value="tram">Tram</option>
            <option value="rail">Rail / metro</option>
            <option value="ferry">Ferry</option>
          </select>
        </Field>
      </div>
      <Field label="Name">
        <input value={route.name} onChange={(e) => patch({ name: e.target.value })} />
      </Field>
      <Field label="Colour">
        <span className="color-input">
          <input type="color" value={route.color} onChange={(e) => patch({ color: e.target.value })} />
          <span className="palette">
            {PALETTE.map((c) => (
              <button
                key={c}
                style={{ background: c }}
                className={c === route.color ? 'active' : ''}
                onClick={() => patch({ color: c })}
              />
            ))}
          </span>
        </span>
      </Field>
      <Toggle
        label="Snap to roads (off = straight lines between stops)"
        checked={route.snap !== false}
        onChange={(v) => {
          patch({ snap: v })
          for (const dirKey of ['fwd', 'bwd']) {
            const dir = route.dirs[dirKey]
            if (!dir) continue
            dir.legs.forEach((_, index) =>
              dispatch({ type: 'resetLeg', routeId: route.id, dirKey, index }),
            )
          }
        }}
      />

      <div className="dir-tabs">
        {['fwd', 'bwd'].map((dirKey) => {
          const dir = route.dirs[dirKey]
          const label = dirKey === 'fwd' ? 'Outbound' : 'Return'
          return (
            <button
              key={dirKey}
              className={activeDirKey === dirKey ? 'active' : ''}
              disabled={dirKey === 'bwd' && !dir}
              onClick={() => setEditing({ routeId: route.id, dirKey })}
            >
              {label} {dir ? `(${dir.stopIds.length})` : '(none)'}
            </button>
          )
        })}
        {activeDirKey && (
          <button className="ghost" onClick={() => setEditing(null)} title="Stop adding stops">
            ⏹ Stop editing
          </button>
        )}
      </div>

      {activeDirKey ? (
        <p className="notice ok small">
          Click stops on the map to append them to the <b>{activeDirKey === 'fwd' ? 'outbound' : 'return'}</b>{' '}
          direction. Drag a drawn line onto another road to reroute that section; right-click the
          line to reset it.
        </p>
      ) : (
        <p className="muted small">Pick a direction above to start adding stops.</p>
      )}

      <div className="button-row">
        {!route.dirs.bwd ? (
          <>
            <button onClick={() => dispatch({ type: 'reverseAuto', routeId: route.id })}>
              ⇄ Mirror outbound as return
            </button>
            <button
              onClick={() => {
                dispatch({ type: 'startManualReverse', routeId: route.id })
                setEditing({ routeId: route.id, dirKey: 'bwd' })
              }}
            >
              ✎ Draw return manually
            </button>
          </>
        ) : (
          <>
            <button onClick={() => dispatch({ type: 'reverseAuto', routeId: route.id })}>
              ⇄ Re-mirror from outbound
            </button>
            <button
              onClick={() => {
                dispatch({ type: 'removeDir', routeId: route.id })
                if (editing?.dirKey === 'bwd') setEditing({ routeId: route.id, dirKey: 'fwd' })
              }}
            >
              ✕ Delete return
            </button>
          </>
        )}
      </div>

      {['fwd', 'bwd'].map((dirKey) => {
        const dir = route.dirs[dirKey]
        if (!dir || (activeDirKey && activeDirKey !== dirKey)) return null
        return (
          <StopSequence
            key={dirKey}
            project={project}
            dispatch={dispatch}
            route={route}
            dirKey={dirKey}
            dir={dir}
            setFocus={setFocus}
            insertAt={insertAt}
            setInsertAt={setInsertAt}
          />
        )
      })}
    </Section>
  )
}

function StopSequence({ project, dispatch, route, dirKey, dir, setFocus, insertAt, setInsertAt }) {
  const total = dir.legs.reduce(
    (sum, leg) => sum + (leg.coords ? polylineLength(leg.coords) : 0),
    0,
  )
  return (
    <div className="sequence">
      <div className="sequence-head">
        <b>{dirKey === 'fwd' ? 'Outbound' : 'Return'}</b>
        <span className="muted small">{formatDistance(total)}</span>
        <button
          className="icon"
          title="Remove every stop from this direction"
          onClick={() => dispatch({ type: 'clearDir', routeId: route.id, dirKey })}
        >
          ⟲
        </button>
      </div>
      {!dir.stopIds.length && <p className="muted small">No stops yet.</p>}
      <ol className="sequence-list">
        {dir.stopIds.map((stopId, i) => {
          const stop = stopById(project, stopId)
          const leg = dir.legs[i]
          return (
            <li key={`${stopId}-${i}`}>
              <div className="row">
                <span className="idx">{i + 1}</span>
                <span
                  className="name"
                  onClick={() =>
                    stop && setFocus({ center: [stop.lat, stop.lon], zoom: 16, nonce: Date.now() })
                  }
                >
                  {stop ? stop.name : '(deleted stop)'}
                </span>
                <button
                  className={
                    insertAt && insertAt.routeId === route.id && insertAt.dirKey === dirKey && insertAt.index === i
                      ? 'icon active'
                      : 'icon'
                  }
                  title="Insert a stop here — then click it on the map"
                  onClick={() =>
                    setInsertAt(
                      insertAt && insertAt.index === i && insertAt.dirKey === dirKey
                        ? null
                        : { routeId: route.id, dirKey, index: i },
                    )
                  }
                >
                  ⤒
                </button>
                <button
                  className="icon"
                  title="Move earlier"
                  disabled={i === 0}
                  onClick={() =>
                    dispatch({ type: 'moveStopInDir', routeId: route.id, dirKey, index: i, delta: -1 })
                  }
                >
                  ↑
                </button>
                <button
                  className="icon"
                  title="Move later"
                  disabled={i === dir.stopIds.length - 1}
                  onClick={() =>
                    dispatch({ type: 'moveStopInDir', routeId: route.id, dirKey, index: i, delta: 1 })
                  }
                >
                  ↓
                </button>
                <button
                  className="icon"
                  title="Remove from route"
                  onClick={() =>
                    dispatch({ type: 'removeStopAt', routeId: route.id, dirKey, index: i })
                  }
                >
                  ✕
                </button>
              </div>
              {leg && (
                <div className={`leg ${leg.status}`}>
                  <span>
                    {leg.status === 'road' && `↳ along roads · ${formatDistance(polylineLength(leg.coords))}`}
                    {leg.status === 'straight' && '↳ straight line'}
                    {leg.status === 'pending' && '↳ routing…'}
                    {leg.status === 'error' && `↳ routing failed: ${leg.error || 'unknown'}`}
                  </span>
                  {leg.vias.length > 0 && <em>{leg.vias.length} detour point(s)</em>}
                  <button
                    className="icon"
                    title="Recalculate this section from scratch"
                    onClick={() =>
                      dispatch({ type: 'resetLeg', routeId: route.id, dirKey, index: i })
                    }
                  >
                    ↻
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
