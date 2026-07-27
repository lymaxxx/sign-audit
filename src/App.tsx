import { useCallback, useEffect, useState } from 'react'
import { StopList } from './ui/StopList'
import { Canvas } from './ui/Canvas'
import { Inspector } from './ui/Inspector'
import { Button } from './ui/controls'
import { useCurrentPage, useFontBook, useFontFaces, useOverflowingStops } from './ui/useSheet'
import { useStore } from './store'
import { onMenu } from './platform'
import {
  defaultExportOptions,
  exportAll,
  exportCurrent,
  importFile,
  openProject,
  openTemplate,
  saveProject,
  saveTemplate,
  type BatchReport,
  type ExportOptions,
} from './ui/actions'

export const App = () => {
  useFontFaces()
  const book = useFontBook()
  const page = useCurrentPage(book)
  const overflowing = useOverflowingStops(book)

  const store = useStore()
  const [exportOptions, setExportOptions] = useState<ExportOptions>(defaultExportOptions)
  const [report, setReport] = useState<BatchReport | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const runExportAll = useCallback(async () => {
    setProgress({ done: 0, total: store.project.timetable.stops.length })
    try {
      const result = await exportAll(exportOptions, (done, total) => setProgress({ done, total }))
      setReport(result)
    } finally {
      setProgress(null)
    }
  }, [exportOptions, store.project.timetable.stops.length])

  // The native menu owns the commands; the web layer decides what they mean.
  useEffect(() => {
    let dispose = () => {}
    onMenu((action) => {
      const s = useStore.getState()
      switch (action) {
        case 'new':
          s.newProject()
          break
        case 'open':
          void openProject()
          break
        case 'save':
          void saveProject()
          break
        case 'import':
          void importFile(true)
          break
        case 'load-template':
          void openTemplate()
          break
        case 'save-template':
          void saveTemplate()
          break
        case 'export':
          void exportCurrent(exportOptions)
          break
        case 'export-all':
          void runExportAll()
          break
        case 'undo':
          s.undo()
          break
        case 'redo':
          s.redo()
          break
        case 'zoom-in':
          s.setZoom(typeof s.zoom === 'number' ? s.zoom * 1.2 : 3)
          break
        case 'zoom-out':
          s.setZoom(typeof s.zoom === 'number' ? s.zoom / 1.2 : 2)
          break
        case 'zoom-fit':
          s.setZoom('fit')
          break
        case 'toggle-guides':
          s.toggleGuides()
          break
      }
    }).then((fn) => {
      dispose = fn
    })
    return () => dispose()
  }, [exportOptions, runExportAll])

  // The same shortcuts in a browser, where there is no native menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (!meta) return
      const s = useStore.getState()
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        s.undo()
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault()
        s.redo()
      } else if (e.key === ';') {
        e.preventDefault()
        s.toggleGuides()
      } else if (e.key === '0') {
        e.preventDefault()
        s.setZoom('fit')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const errors = store.issues.filter((i) => i.severity === 'error')
  const warnings = store.issues.filter((i) => i.severity === 'warning')

  return (
    <div className="app">
      <header className="toolbar">
        <strong className="brand">Algach</strong>

        <Button onClick={() => void importFile(true)}>Import…</Button>
        <Button variant="ghost" onClick={() => void importFile(false)} title="Add to what is already loaded">
          Merge…
        </Button>

        <span className="divider" />

        <Button variant="ghost" onClick={() => void openProject()}>
          Open
        </Button>
        <Button variant="ghost" onClick={() => void saveProject()}>
          Save
        </Button>

        <span className="divider" />

        <Button variant="ghost" onClick={() => void openTemplate()} title="Apply a saved template">
          Load template
        </Button>
        <Button variant="ghost" onClick={() => void saveTemplate()}>
          Save template
        </Button>

        <span className="spacer" />

        <label className="toggle inline">
          <input
            type="checkbox"
            checked={store.showGuides}
            onChange={() => store.toggleGuides()}
          />
          <span>Guides</span>
        </label>

        <label className="toggle inline">
          <input
            type="checkbox"
            checked={exportOptions.outlineText}
            onChange={(e) => setExportOptions((o) => ({ ...o, outlineText: e.target.checked }))}
          />
          <span title="Heavier files, but nothing left for a RIP to substitute">Outline text</span>
        </label>

        <Button variant="ghost" onClick={() => store.undo()} disabled={!store.canUndo()}>
          Undo
        </Button>
        <Button variant="ghost" onClick={() => store.redo()} disabled={!store.canRedo()}>
          Redo
        </Button>

        <Button variant="primary" onClick={() => void exportCurrent(exportOptions)} disabled={!page}>
          Export sheet
        </Button>
        <Button
          variant="primary"
          onClick={() => void runExportAll()}
          disabled={store.project.timetable.stops.length === 0}
          title="One PDF per stop"
        >
          Export all {store.project.timetable.stops.length}
        </Button>
      </header>

      {errors.length > 0 || warnings.length > 0 ? (
        <div className={`banner${errors.length ? ' is-error' : ''}`}>
          {errors.length > 0 ? <strong>{errors[0]!.message}</strong> : null}
          {errors.length === 0 && warnings.length > 0 ? (
            <span>
              {warnings.length} row{warnings.length === 1 ? '' : 's'} could not be read.{' '}
              <em>{warnings[0]!.message}</em>
            </span>
          ) : null}
          <button className="banner-close" onClick={() => store.setIssues([])}>
            ×
          </button>
        </div>
      ) : null}

      <main className="workspace">
        <StopList overflowing={overflowing} />
        {book ? <Canvas page={page} /> : <div className="canvas-viewport"><p className="empty">Loading fonts…</p></div>}
        <Inspector page={page} />
      </main>

      {store.busy || progress ? (
        <div className="scrim">
          <div className="progress-card">
            <p>{progress ? `Writing sheet ${progress.done} of ${progress.total}…` : store.busy}</p>
            {progress ? (
              <div className="bar">
                <span style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {report ? (
        <div className="scrim" onClick={() => setReport(null)}>
          <div className="progress-card" onClick={(e) => e.stopPropagation()}>
            <h3>Exported {report.written} sheets</h3>
            {report.destination ? <p className="readout">{report.destination}</p> : null}
            {report.overflowing.length > 0 ? (
              <>
                <p className="warn">
                  {report.overflowing.length} did not fit even at the smallest allowed size:
                </p>
                <ul className="overflow-list">
                  {report.overflowing.slice(0, 12).map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                  {report.overflowing.length > 12 ? <li>…and {report.overflowing.length - 12} more</li> : null}
                </ul>
              </>
            ) : (
              <p className="readout">Every sheet fitted.</p>
            )}
            <Button onClick={() => setReport(null)}>Close</Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
