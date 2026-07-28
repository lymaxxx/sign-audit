import { useEffect, useRef, useState } from 'react'
import { Field, Section, Toggle } from './controls.jsx'
import { searchPlaces } from '../services/nominatim.js'
import { fetchStops, STOP_KINDS } from '../services/overpass.js'
import { haversine } from '../lib/geo.js'
import { demoProject } from '../sample/demo.js'

export default function DataPanel({
  project,
  dispatch,
  tool,
  setTool,
  setFocus,
  selectedStopId,
  onSelectStop,
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
      text: `Added ${project.lastImport.added} stops (${project.lastImport.merged} platforms merged into existing stops).`,
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

        <Field label="Merge platforms within (m)" hint="Combines both sides of a street that share a name into one stop.">
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
                    <span className="name">{stop.name}</span>
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
