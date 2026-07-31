import { useEffect, useRef, useState } from 'react'
import { Field, Section, Toggle } from './controls.jsx'
import { searchPlaces } from '../services/nominatim.js'
import { fetchStops, STOP_KINDS } from '../services/overpass.js'
import { fetchOsmRoute } from '../services/osmRoute.js'
import { haversine } from '../lib/geo.js'
import { newId } from '../state/project.js'
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
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [kinds, setKinds] = useState({ bus: true, tram: true, rail: false, ferry: false })
  const [mergeRadius, setMergeRadius] = useState(45)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState(null)
  const [filter, setFilter] = useState('')
  const abortRef = useRef(null)

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
        </div>

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

      <OsmRouteImport dispatch={dispatch} onRouteImported={onRouteImported} />

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

function OsmRouteImport({ dispatch, onRouteImported }) {
  const [input, setInput] = useState('')
  const [bwdInput, setBwdInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState(null)
  const [preview, setPreview] = useState(null)
  const [mergeRadius, setMergeRadius] = useState(30)
  const abortRef = useRef(null)

  const fetchPreview = async (e) => {
    e.preventDefault()
    if (!input.trim()) return
    setLoading(true)
    setElapsed(0)
    setError(null)
    setPreview(null)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const tick = setInterval(() => setElapsed((s) => s + 1), 1000)
    try {
      const primary = await fetchOsmRoute(input, { signal: controller.signal })
      let route = primary
      if (bwdInput.trim()) {
        // An explicit return-direction ID always wins over whatever the
        // primary relation brought (e.g. if it turned out to be a
        // route_master already carrying both directions).
        const second = await fetchOsmRoute(bwdInput, { signal: controller.signal })
        route = { ...primary, bwd: second.fwd }
      }
      const legCount = (dirLegs) => dirLegs.filter((l) => !l.pending).length
      setPreview({
        route,
        fwdRouted: legCount(route.fwd.legs),
        fwdTotal: route.fwd.legs.length,
        bwdRouted: route.bwd ? legCount(route.bwd.legs) : 0,
        bwdTotal: route.bwd ? route.bwd.legs.length : 0,
      })
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message)
    } finally {
      clearInterval(tick)
      setLoading(false)
    }
  }

  const addToProject = () => {
    if (!preview) return
    // Mint the id here rather than reading it back out of project state
    // afterwards: a "route was just imported" flag living in the project
    // persists (localStorage included), so reacting to it would re-fire this
    // navigation every time the panel mounts.
    const routeId = newId('r')
    dispatch({ type: 'importOsmRoute', route: preview.route, mergeRadius, routeId })
    onRouteImported?.(routeId)
    setPreview(null)
    setInput('')
    setBwdInput('')
  }

  return (
    <Section title="Import a route from OpenStreetMap" defaultOpen={false}>
      <p className="muted small">
        Paste a route's relation ID or its openstreetmap.org URL — the same relation you'd get to
        by clicking a stop there and picking a route. Both the stops and the road/rail geometry
        come across; a route_master brings in both directions automatically.
      </p>
      <form onSubmit={fetchPreview} className="search-form">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="123456 or https://www.openstreetmap.org/relation/123456"
        />
        <button type="submit" disabled={loading}>
          {loading ? '…' : 'Fetch'}
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
          disabled={loading}
        />
      </Field>
      {loading && (
        <p className="muted small">
          Fetching from OpenStreetMap… {elapsed}s{' '}
          {elapsed > 8
            ? '(this is normal for a long route — a route_master fetches both directions as two rounds, so up to ~2-3 minutes on a slow day)'
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
      {preview && (
        <div className="notice ok small">
          <p style={{ margin: 0 }}>
            <b>
              {preview.route.ref ? `${preview.route.ref} — ` : ''}
              {preview.route.name || 'Unnamed route'}
            </b>
          </p>
          <p style={{ margin: '4px 0' }}>
            Outbound: {preview.route.fwd.stops.length} stops, {preview.fwdRouted}/{preview.fwdTotal}{' '}
            sections with real OSM geometry
            {preview.route.bwd && (
              <>
                <br />
                Return: {preview.route.bwd.stops.length} stops, {preview.bwdRouted}/{preview.bwdTotal}{' '}
                sections with real OSM geometry
              </>
            )}
          </p>
          {(preview.fwdTotal - preview.fwdRouted > 0 || preview.bwdTotal - preview.bwdRouted > 0) && (
            <p style={{ margin: '4px 0' }}>
              Sections without real geometry will be routed automatically once added, same as a
              leg drawn by hand.
            </p>
          )}
          <div className="button-row">
            <button className="primary" onClick={addToProject}>
              + Add to project
            </button>
            <button onClick={() => setPreview(null)}>Discard</button>
          </div>
        </div>
      )}
    </Section>
  )
}
