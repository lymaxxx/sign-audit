import { useEffect, useMemo, useRef, useState } from 'react'
import { Field, Section, Toggle } from './controls.jsx'
import { searchPlaces } from '../services/nominatim.js'
import { fetchRoads, fetchStops, STOP_KINDS } from '../services/overpass.js'
import { fetchOsmRoute, parseRelationRef } from '../services/osmRoute.js'
import { haversine } from '../lib/geo.js'
import { findOppositeKerbs, newId } from '../state/project.js'
import { demoProject } from '../sample/demo.js'

export default function DataPanel({
  project,
  dispatch,
  tool,
  setTool,
  setFocus,
  selectedStopId,
  onSelectStop,
  onRouteImported,
  importQueue,
  setImportQueue,
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [kinds, setKinds] = useState({ bus: true, tram: true, rail: false, ferry: false })
  const [mergeRadius, setMergeRadius] = useState(45)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState(null)
  const [filter, setFilter] = useState('')
  const [kerbRadius, setKerbRadius] = useState(130)
  const [streetsLoading, setStreetsLoading] = useState(false)
  const abortRef = useRef(null)

  const kerbPairs = useMemo(() => findOppositeKerbs(project, kerbRadius), [project, kerbRadius])

  const runSearch = async (e) => {
    e.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    setMessage(null)
    try {
      setResults(await searchPlaces(query))
    } catch (err) {
      setMessage({ kind: 'error', text: err.message })
    } finally {
      setSearching(false)
    }
  }

  const loadStops = async () => {
    if (!project.bbox) return
    setLoading(true)
    setMessage(null)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const stops = await fetchStops(project.bbox, kinds, { signal: controller.signal })
      dispatch({ type: 'addStops', stops, mergeRadius })
      setMessage({ kind: 'ok', text: `Found ${stops.length} stop records in the area.` })
    } catch (err) {
      if (err.name !== 'AbortError') setMessage({ kind: 'error', text: err.message })
    } finally {
      setLoading(false)
    }
  }

  const loadStreets = async () => {
    if (!project.bbox) return
    setStreetsLoading(true)
    setMessage(null)
    try {
      const streets = await fetchRoads(project.bbox)
      dispatch({ type: 'setStreets', streets })
      setMessage({
        kind: 'ok',
        text: streets.length
          ? `Loaded ${streets.length} named street sections for the backdrop.`
          : 'No named streets found in this area.',
      })
    } catch (err) {
      if (err.name !== 'AbortError') setMessage({ kind: 'error', text: err.message })
    } finally {
      setStreetsLoading(false)
    }
  }

  useEffect(() => {
    if (!project.lastImport) return
    setMessage({
      kind: 'ok',
      text: project.lastImport.regrouped
        ? `Merged ${project.lastImport.merged} stop(s) into their twins — routes now share one marker per stop.`
        : project.lastImport.routeImport
          ? `Route imported — ${project.lastImport.added} new stops, ${project.lastImport.merged} matched to ones already here.`
          : `Added ${project.lastImport.added} stops (${project.lastImport.merged} platforms folded into existing stops).`,
    })
  }, [project.lastImport])

  const area = project.bbox
    ? (haversine([project.bbox[0], project.bbox[1]], [project.bbox[0], project.bbox[3]]) *
        haversine([project.bbox[0], project.bbox[1]], [project.bbox[2], project.bbox[1]])) /
      1e6
    : 0

  const visibleStops = project.stops.filter((s) =>
    s.name.toLowerCase().includes(filter.trim().toLowerCase()),
  )

  return (
    <>
      <Section title="Find a place">
        <form onSubmit={runSearch} className="search-form">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="City, district, street…"
          />
          <button type="submit" disabled={searching}>
            {searching ? '…' : 'Search'}
          </button>
        </form>
        {results.length > 0 && (
          <ul className="result-list">
            {results.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => {
                    setFocus({ center: [r.lat, r.lon], bbox: r.bbox, nonce: Date.now() })
                    setResults([])
                  }}
                >
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Area & stops">
        <div className="button-row">
          <button
            className={tool === 'bbox' ? 'primary active' : 'primary'}
            onClick={() => setTool(tool === 'bbox' ? 'select' : 'bbox')}
          >
            {tool === 'bbox' ? '✎ Drawing — drag on the map' : '▭ Draw bounding box'}
          </button>
          {project.bbox && (
            <button onClick={() => dispatch({ type: 'setBbox', bbox: null })}>Clear</button>
          )}
        </div>
        {project.bbox && (
          <p className="muted small">
            Area ≈ {area.toFixed(1)} km² · {project.bbox.map((v) => v.toFixed(4)).join(', ')}
          </p>
        )}

        <div className="chips">
          {Object.entries(STOP_KINDS).map(([key, label]) => (
            <Toggle
              key={key}
              label={label}
              checked={kinds[key]}
              onChange={(v) => setKinds((k) => ({ ...k, [key]: v }))}
            />
          ))}
        </div>

        <Field
          label="Merge platforms within (m)"
          hint="Both sides of a street become one stop with two platforms. Names like 'Foo (east)' or 'Foo platform 2' count as the same stop."
        >
          <input
            type="number"
            min={0}
            max={200}
            value={mergeRadius}
            onChange={(e) => setMergeRadius(Number(e.target.value))}
          />
        </Field>

        <div className="button-row">
          <button className="primary" onClick={loadStops} disabled={!project.bbox || loading}>
            {loading ? 'Querying OpenStreetMap…' : '⇩ Load stops in area'}
          </button>
          <button
            onClick={loadStreets}
            disabled={!project.bbox || streetsLoading}
            title="Fetches the named streets in the box. The schematic warps them to follow the diagram, so they read as a pale backdrop behind the lines."
          >
            {streetsLoading ? 'Querying…' : '⇩ Load streets'}
          </button>
        </div>
        {project.streets?.length > 0 && (
          <p className="muted small">
            {project.streets.length} street sections loaded — turn the backdrop on under Schematic
            style → Background streets.
          </p>
        )}

        <div className="button-row">
          <button
            onClick={() => dispatch({ type: 'regroupStops', mergeRadius })}
            disabled={!project.stops.length}
            title="Fold stops that share a name (ignoring (east)/(south)/platform suffixes) into one stop with several platforms"
          >
            ⧉ Merge duplicate stops
          </button>
          <button
            className={tool === 'link' ? 'active' : ''}
            onClick={() => setTool(tool === 'link' ? 'select' : 'link')}
            disabled={project.stops.length < 2}
            title="For stops that are the same place but keep a different name on each side — e.g. Gibraltar's two-name stops"
          >
            🔗 Link two stops
          </button>
        </div>
        <div className="button-row">
          <button
            onClick={() => dispatch({ type: 'linkOppositeKerbs', radius: kerbRadius })}
            disabled={!kerbPairs.length}
            title="Finds stops swapped one-for-one between a route's two directions and close enough together to be the same place"
          >
            ⇄ Link opposite kerbs{kerbPairs.length ? ` (${kerbPairs.length})` : ''}
          </button>
          <input
            type="number"
            min={20}
            max={400}
            step={10}
            value={kerbRadius}
            onChange={(e) => setKerbRadius(Number(e.target.value))}
            title="How far apart the two kerbs may be, in metres"
            style={{ width: 70 }}
          />
        </div>
        {kerbPairs.length > 0 && (
          <p className="muted small">
            {kerbPairs
              .slice(0, 4)
              .map((p) => p.names.join(' ⇄ '))
              .join(', ')}
            {kerbPairs.length > 4 ? `, and ${kerbPairs.length - 4} more` : ''}. Linking these stops
            each pair showing as two lines with arrows where the route actually runs both ways.
          </p>
        )}
        {tool === 'link' && (
          <p className="notice ok small">
            Click a stop on the map, then click its differently-named twin. They'll become one
            stop with both names (joined by ⇄) and one marker on the schematic.
          </p>
        )}

        <div className="button-row">
          <button
            className={tool === 'addStop' ? 'active' : ''}
            onClick={() => setTool(tool === 'addStop' ? 'select' : 'addStop')}
          >
            + Add stop by clicking
          </button>
          <button
            onClick={() => {
              if (confirm('Remove every stop and route from this project?')) {
                dispatch({ type: 'clearStops' })
              }
            }}
            disabled={!project.stops.length}
          >
            Clear all
          </button>
        </div>

        {message && <p className={`notice ${message.kind}`}>{message.text}</p>}
      </Section>

      <OsmRouteImport
        dispatch={dispatch}
        onRouteImported={onRouteImported}
        rows={importQueue}
        setRows={setImportQueue}
      />

      <Section title={`Stops (${project.stops.length})`}>
        {!project.stops.length && (
          <p className="muted small">
            No stops yet. Draw a box and load them from OpenStreetMap, or{' '}
            <button
              className="link"
              onClick={() => dispatch({ type: 'load', project: demoProject() })}
            >
              load the demo network
            </button>
            .
          </p>
        )}
        {project.stops.length > 0 && (
          <>
            <input
              className="filter"
              value={filter}
              placeholder="Filter stops…"
              onChange={(e) => setFilter(e.target.value)}
            />
            <ul className="stop-list">
              {visibleStops.slice(0, 400).map((stop) => (
                <li
                  key={stop.id}
                  className={stop.id === selectedStopId ? 'selected' : ''}
                  onClick={() => {
                    onSelectStop(stop.id)
                    setFocus({ center: [stop.lat, stop.lon], zoom: 16, nonce: Date.now() })
                  }}
                >
                  <span className={`dot ${stop.kind}`} />
                  {(stop.platforms?.length || 1) > 1 && (
                    <span className="platform-count" title={`${stop.platforms.length} platforms`}>
                      {stop.platforms.length}
                    </span>
                  )}
                  {stop.id === selectedStopId ? (
                    <input
                      value={stop.name}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        dispatch({ type: 'updateStop', id: stop.id, patch: { name: e.target.value } })
                      }
                    />
                  ) : (
                    <span className="name">
                      {stop.name}
                      {(stop.altNames || []).map((n) => (
                        <em key={n} className="alt-name">
                          ⇄ {n}
                        </em>
                      ))}
                    </span>
                  )}
                  {(stop.altNames || []).length > 0 && (
                    <button
                      className="icon"
                      title="Split back into separate stops"
                      onClick={(e) => {
                        e.stopPropagation()
                        dispatch({ type: 'unlinkStop', id: stop.id })
                      }}
                    >
                      ✂
                    </button>
                  )}
                  <button
                    className="icon"
                    title="Delete stop"
                    onClick={(e) => {
                      e.stopPropagation()
                      dispatch({ type: 'deleteStop', id: stop.id })
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            {visibleStops.length > 400 && (
              <p className="muted small">Showing the first 400 of {visibleStops.length}.</p>
            )}
          </>
        )}
      </Section>
    </>
  )
}

function routeStats(route) {
  const routed = (legs) => legs.filter((l) => !l.pending).length
  return {
    fwdStops: route.fwd.stops.length,
    fwdRouted: routed(route.fwd.legs),
    fwdTotal: route.fwd.legs.length,
    bwdStops: route.bwd ? route.bwd.stops.length : 0,
    bwdRouted: route.bwd ? routed(route.bwd.legs) : 0,
    bwdTotal: route.bwd ? route.bwd.legs.length : 0,
  }
}

const STATUS_LABEL = { queued: '·', fetching: '…', done: '✓', error: '!' }

// A queue rather than a single fetch: each relation takes 30-60s on a loaded
// public Overpass instance, so importing a network one route at a time means
// sitting and waiting between every one. Paste them all first, then walk the
// queue unattended.
function OsmRouteImport({ dispatch, onRouteImported, rows, setRows }) {
  const [input, setInput] = useState('')
  const [bwdInput, setBwdInput] = useState('')
  const [number, setNumber] = useState('')
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState(null)
  const [mergeRadius, setMergeRadius] = useState(30)
  const abortRef = useRef(null)

  const patchRow = (key, patch) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  // Builds a row out of whatever is currently typed, clearing the form.
  // Returns null (and sets the error) if there's nothing usable there.
  const takeFormRow = () => {
    const relationId = input.trim()
    if (!relationId) return null
    if (!parseRelationRef(relationId)) {
      setError("That doesn't look like an OSM relation ID or URL.")
      return null
    }
    if (bwdInput.trim() && !parseRelationRef(bwdInput)) {
      setError("The return-direction ID doesn't look like an OSM relation ID or URL.")
      return null
    }
    setError(null)
    setInput('')
    setBwdInput('')
    setNumber('')
    return {
      key: newId('q'),
      relationId,
      bwdRelationId: bwdInput.trim(),
      number: number.trim(),
      status: 'queued',
      route: null,
      stats: null,
      error: null,
    }
  }

  const addRow = (e) => {
    e?.preventDefault()
    const row = takeFormRow()
    if (row) setRows((rs) => [...rs, row])
  }

  const fetchAll = async () => {
    // Don't silently ignore a half-filled form — an ID typed but not yet
    // added is obviously meant to be part of the run.
    const pending = takeFormRow()
    const queue = pending ? [...rows, pending] : rows
    if (pending) setRows(queue)
    const todo = queue.filter((r) => r.status === 'queued' || r.status === 'error')
    if (!todo.length) return

    setRunning(true)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    // Sequential on purpose: the mirrors are shared and rate-limited, and
    // queryOverpass already races all three of them within a single request,
    // so firing rows off in parallel would only collide with itself.
    for (const row of todo) {
      if (controller.signal.aborted) break
      patchRow(row.key, { status: 'fetching', error: null })
      setElapsed(0)
      const tick = setInterval(() => setElapsed((s) => s + 1), 1000)
      try {
        const primary = await fetchOsmRoute(row.relationId, { signal: controller.signal })
        let route = primary
        if (row.bwdRelationId) {
          // An explicit return-direction ID always wins over whatever the
          // primary relation brought (e.g. if it turned out to be a
          // route_master already carrying both directions).
          const second = await fetchOsmRoute(row.bwdRelationId, { signal: controller.signal })
          route = { ...primary, bwd: second.fwd }
        }
        patchRow(row.key, { status: 'done', route, stats: routeStats(route) })
      } catch (err) {
        if (err.name === 'AbortError') {
          patchRow(row.key, { status: 'queued' })
          break
        }
        // One bad relation shouldn't cost the whole run — record it and
        // carry on; a later Fetch will retry anything left in error.
        patchRow(row.key, { status: 'error', error: err.message })
      } finally {
        clearInterval(tick)
      }
    }
    setRunning(false)
  }

  const addAllToProject = () => {
    const done = rows.filter((r) => r.status === 'done')
    if (!done.length) return
    let firstId = null
    for (const row of done) {
      // Mint the id here rather than reading it back out of project state
      // afterwards: a "route was just imported" flag living in the project
      // persists (localStorage included), so reacting to it would re-fire
      // this navigation every time the panel mounts.
      const routeId = newId('r')
      if (!firstId) firstId = routeId
      const route = row.number ? { ...row.route, ref: row.number } : row.route
      dispatch({ type: 'importOsmRoute', route, mergeRadius, routeId })
    }
    setRows((rs) => rs.filter((r) => r.status !== 'done'))
    onRouteImported?.(firstId)
  }

  const doneCount = rows.filter((r) => r.status === 'done').length
  const pendingCount = rows.filter((r) => r.status === 'queued' || r.status === 'error').length

  return (
    <Section title="Import routes from OpenStreetMap" defaultOpen={false}>
      <p className="muted small">
        Paste a route's relation ID or its openstreetmap.org URL — the same relation you'd get to
        by clicking a stop there and picking a route. Add as many as you like, then fetch them all
        in one go. Both the stops and the road/rail geometry come across; a route_master brings in
        both directions automatically.
      </p>
      <form onSubmit={addRow} className="search-form">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="123456 or https://www.openstreetmap.org/relation/123456"
        />
        <button type="submit" disabled={running}>
          + Add
        </button>
      </form>
      <Field
        label="Return direction relation ID (optional)"
        hint="If the two directions are separate relations with no shared route_master, paste the return one here — it always overrides whatever direction the first ID brought on its own."
      >
        <input
          value={bwdInput}
          onChange={(e) => setBwdInput(e.target.value)}
          placeholder="Leave blank if the ID above already covers both directions"
          disabled={running}
        />
      </Field>
      <Field
        label="Route number (optional)"
        hint="Overrides the ref tag from OSM. Leave blank to use whatever the relation is tagged with."
      >
        <input
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          placeholder="e.g. 12A"
          disabled={running}
        />
      </Field>

      {rows.length > 0 && (
        <ul className="queue-list">
          {rows.map((row) => (
            <li key={row.key} className={row.status}>
              <span className="badge" title={row.status}>
                {STATUS_LABEL[row.status]}
              </span>
              <span className="name">
                <b>{row.number || row.route?.ref || `#${row.relationId}`}</b>{' '}
                {row.route ? row.route.name || 'Unnamed route' : row.relationId}
                {row.bwdRelationId && <em className="alt-name"> ⇄ {row.bwdRelationId}</em>}
                {row.stats && (
                  <em className="counts">
                    {row.stats.fwdStops} stops, {row.stats.fwdRouted}/{row.stats.fwdTotal} sections
                    with OSM geometry
                    {row.route.bwd &&
                      ` · return ${row.stats.bwdStops} stops, ${row.stats.bwdRouted}/${row.stats.bwdTotal}`}
                  </em>
                )}
                {row.error && <em className="counts err">{row.error}</em>}
              </span>
              <button
                className="icon"
                title="Remove from queue"
                disabled={running}
                onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="button-row">
        <button
          className="primary"
          onClick={fetchAll}
          disabled={running || (!pendingCount && !input.trim())}
        >
          {running ? 'Fetching…' : `⇩ Fetch ${pendingCount || ''} queued`.trim()}
        </button>
        {running && <button onClick={() => abortRef.current?.abort()}>Cancel</button>}
        {!running && rows.length > 0 && (
          <button onClick={() => setRows([])}>Clear queue</button>
        )}
      </div>
      {running && (
        <p className="muted small">
          Fetching from OpenStreetMap… {elapsed}s{' '}
          {elapsed > 8
            ? '(normal for a long route — a route_master fetches both directions as two rounds, so up to ~2-3 minutes on a slow day)'
            : ''}
        </p>
      )}

      <Field
        label="Merge platforms within (m)"
        hint="Same as the area import — folds a stop_position/platform pair or two close-together records into one stop."
      >
        <input
          type="number"
          min={0}
          max={200}
          value={mergeRadius}
          onChange={(e) => setMergeRadius(Number(e.target.value))}
        />
      </Field>
      {error && <p className="notice error small">{error}</p>}
      {doneCount > 0 && (
        <div className="button-row">
          <button className="primary" onClick={addAllToProject} disabled={running}>
            + Add {doneCount} route{doneCount > 1 ? 's' : ''} to project
          </button>
        </div>
      )}
    </Section>
  )
}
