import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import MapCanvas, { BASEMAPS } from './map/MapCanvas.jsx'
import SchematicView from './schematic/SchematicView.jsx'
import DataPanel from './ui/DataPanel.jsx'
import RoutesPanel from './ui/RoutesPanel.jsx'
import StylePanel from './ui/StylePanel.jsx'
import { useAutoRouting } from './hooks/useAutoRouting.js'
import {
  emptyProject,
  loadStoredProject,
  migrate,
  projectReducer,
  storeProject,
} from './state/project.js'
import { demoProject } from './sample/demo.js'
import { bboxFromPoints } from './lib/geo.js'

const TABS = [
  { key: 'data', label: 'Map data' },
  { key: 'routes', label: 'Routes' },
  { key: 'style', label: 'Schematic style' },
]

export default function App() {
  const [project, dispatch] = useReducer(
    projectReducer,
    null,
    () => loadStoredProject() || emptyProject(),
  )
  const [view, setView] = useState('map')
  const [tab, setTab] = useState('data')
  const [tool, setTool] = useState('select')
  const [editing, setEditing] = useState(null)
  const [selectedStopId, setSelectedStopId] = useState(null)
  const [selectedRouteId, setSelectedRouteId] = useState(null)
  const [focus, setFocus] = useState(null)
  const [insertAt, setInsertAt] = useState(null)
  const [linking, setLinking] = useState(null)
  // Lives up here rather than inside the import panel: adding a batch jumps to
  // the Routes tab, which unmounts DataPanel, and a queue that evaporated on
  // that jump would take any row that failed to fetch with it — exactly the
  // re-typing the queue exists to avoid.
  const [importQueue, setImportQueue] = useState([])
  const [basemap, setBasemap] = useState('light')
  const fileRef = useRef(null)
  const routing = useAutoRouting(project, dispatch)

  useEffect(() => {
    const t = setTimeout(() => storeProject(project), 400)
    return () => clearTimeout(t)
  }, [project])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setEditing(null)
        setInsertAt(null)
        setLinking(null)
        setTool('select')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Drawing a box switches the tool back off so the map is clickable again.
  const onBbox = useCallback((bbox) => {
    dispatch({ type: 'setBbox', bbox })
    setTool('select')
  }, [])

  useEffect(() => {
    if (tool !== 'link') setLinking(null)
  }, [tool])

  // First click on a stop while the "link stops" tool is active picks the
  // stop to keep; the second click picks the differently-named twin to fold
  // into it (the Gibraltar case: same physical stop, different name per side).
  const onLinkStop = useCallback(
    (stopId) => {
      setLinking((prev) => {
        if (!prev) return { first: stopId }
        if (prev.first === stopId) return prev
        dispatch({ type: 'linkStops', keepId: prev.first, mergeId: stopId })
        setTool('select')
        return null
      })
    },
    [dispatch],
  )

  const exportProject = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${(project.name || 'network').replace(/\s+/g, '-').toLowerCase()}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  const importProject = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      dispatch({ type: 'load', project: migrate(JSON.parse(text)) })
      setEditing(null)
    } catch (err) {
      alert(`Could not read that file: ${err.message}`)
    }
    e.target.value = ''
  }

  const fitToData = () => {
    const bbox = bboxFromPoints(project.stops.map((s) => [s.lat, s.lon]))
    if (bbox) setFocus({ bbox, nonce: Date.now() })
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◉</span>
          <input
            className="project-name"
            value={project.name}
            onChange={(e) => dispatch({ type: 'rename', name: e.target.value })}
          />
        </div>

        <div className="view-switch">
          <button className={view === 'map' ? 'active' : ''} onClick={() => setView('map')}>
            🗺 Map
          </button>
          <button
            className={view === 'schematic' ? 'active' : ''}
            onClick={() => setView('schematic')}
          >
            ▤ Schematic
          </button>
        </div>

        <div className="top-actions">
          {view === 'map' && (
            <select value={basemap} onChange={(e) => setBasemap(e.target.value)} title="Base map">
              {Object.entries(BASEMAPS).map(([key, cfg]) => (
                <option key={key} value={key}>
                  {cfg.label}
                </option>
              ))}
            </select>
          )}
          {view === 'map' && (
            <button onClick={fitToData} disabled={!project.stops.length}>
              ⤢ Fit to stops
            </button>
          )}
          <button onClick={() => dispatch({ type: 'load', project: demoProject() })}>Demo</button>
          <button onClick={() => fileRef.current.click()}>⇧ Import</button>
          <button onClick={exportProject}>⇩ Export</button>
          <button
            onClick={() => {
              if (confirm('Start a new, empty project? Export first if you want to keep this one.')) {
                dispatch({ type: 'reset' })
                setEditing(null)
                setSelectedRouteId(null)
              }
            }}
          >
            New
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            hidden
            onChange={importProject}
          />
        </div>
      </header>

      <div className="body">
        <aside className="sidebar">
          <nav className="tabs">
            {TABS.map((t) => (
              <button
                key={t.key}
                className={tab === t.key ? 'active' : ''}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="panel-scroll">
            {tab === 'data' && (
              <DataPanel
                project={project}
                dispatch={dispatch}
                tool={tool}
                setTool={setTool}
                setFocus={setFocus}
                selectedStopId={selectedStopId}
                onSelectStop={setSelectedStopId}
                importQueue={importQueue}
                setImportQueue={setImportQueue}
                onRouteImported={(routeId) => {
                  setTab('routes')
                  setSelectedRouteId(routeId)
                }}
              />
            )}
            {tab === 'routes' && (
              <RoutesPanel
                project={project}
                dispatch={dispatch}
                editing={editing}
                setEditing={setEditing}
                selectedRouteId={selectedRouteId}
                setSelectedRouteId={setSelectedRouteId}
                setFocus={setFocus}
                insertAt={insertAt}
                setInsertAt={setInsertAt}
              />
            )}
            {tab === 'style' && <StylePanel project={project} dispatch={dispatch} />}
          </div>
          <footer className="side-footer">
            {routing.pending > 0 ? (
              <span className="busy">Routing {routing.pending} section(s)…</span>
            ) : routing.error ? (
              <span className="error" title={routing.error}>
                Routing problem — straight lines used
              </span>
            ) : (
              <span className="muted">
                {project.stops.length} stops · {project.routes.length} routes
              </span>
            )}
          </footer>
        </aside>

        <main className="stage">
          {view === 'map' ? (
            <>
              <MapCanvas
                project={project}
                dispatch={dispatch}
                tool={tool}
                editing={editing}
                selectedStopId={selectedStopId}
                onSelectStop={setSelectedStopId}
                onBbox={onBbox}
                focus={focus}
                basemap={basemap}
                insertAt={insertAt}
                onInserted={() => setInsertAt(null)}
                onLinkStop={onLinkStop}
              />
              {tool === 'link' && (
                <div className="editing-banner">
                  {linking
                    ? 'Now click the differently-named stop that is really the same place'
                    : 'Click a stop, then click its differently-named twin on the other side'}
                  <button
                    onClick={() => {
                      setLinking(null)
                      setTool('select')
                    }}
                  >
                    cancel
                  </button>
                </div>
              )}
              {insertAt && (
                <div className="editing-banner">
                  Click a stop to insert it at position <b>{insertAt.index + 1}</b>
                  <button onClick={() => setInsertAt(null)}>cancel</button>
                </div>
              )}
              {editing && !insertAt && (
                <div className="editing-banner">
                  Adding stops to{' '}
                  <b>
                    {project.routes.find((r) => r.id === editing.routeId)?.number}{' '}
                    {editing.dirKey === 'fwd' ? 'outbound' : 'return'}
                  </b>{' '}
                  — click stops in order
                  <button onClick={() => setEditing(null)}>done</button>
                </div>
              )}
              {tool === 'bbox' && (
                <div className="editing-banner">Drag on the map to draw the area to import</div>
              )}
              {tool === 'addStop' && (
                <div className="editing-banner">Click the map to place a new stop</div>
              )}
            </>
          ) : (
            <SchematicView project={project} dispatch={dispatch} onSelectStop={setSelectedStopId} />
          )}
        </main>
      </div>
    </div>
  )
}
