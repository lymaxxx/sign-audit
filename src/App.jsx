import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PlanView from './map/PlanView.jsx'
import { useViewport } from './map/useViewport.js'
import { unionBounds } from './dxf/geometry.js'
import Filters from './ui/Filters.jsx'
import ImportScreen from './ui/ImportScreen.jsx'
import LayerToggle from './ui/LayerToggle.jsx'
import OfflineNotice from './ui/OfflineNotice.jsx'
import SignList, { Progress } from './ui/SignList.jsx'
import SignPanel from './ui/SignPanel.jsx'
import UnderlayPanel from './ui/UnderlayPanel.jsx'
import { useStore } from './state/storeContext.js'
import { STATUS_ORDER } from './util/status.js'
import { SHEET_FRACTION, WIDE_QUERY, useMediaQuery } from './util/useMediaQuery.js'

const emptyFilters = { query: '', types: new Set(), statuses: new Set(), sort: 'name' }

// How far to zoom in when jumping to a sign, relative to the scale that fits
// the *whole* plan in view. A fixed pixels-per-unit constant does not work
// across drawings — the same number reads as "reasonable" on one plan and as
// a many-thousand-times zoom-in on another, depending on the drawing's native
// units (mm, inches, feet…). Scaling off the plan's own fit level sidesteps
// that entirely: this always shows roughly the same fraction of the drawing
// around the sign, whatever units it was drawn in.
const LOCATE_ZOOM_FACTOR = 15

function sortSigns(signs, sort) {
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })
  const copy = [...signs]
  switch (sort) {
    case 'type':
      return copy.sort((a, b) => a.type.localeCompare(b.type) || byName(a, b))
    case 'status':
      return copy.sort(
        (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || byName(a, b),
      )
    case 'updated':
      return copy.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    default:
      return copy.sort(byName)
  }
}

export default function App() {
  const { status, project, plan, underlay, error, busy, actions } = useStore()
  const viewport = useViewport()
  const wide = useMediaQuery(WIDE_QUERY)

  const [tab, setTab] = useState('plan')
  const [selectedId, setSelectedId] = useState(null)
  const [addMode, setAddMode] = useState(false)
  const [alignMode, setAlignMode] = useState(false)
  const [sheet, setSheet] = useState(null)
  const [filters, setFilters] = useState(emptyFilters)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  // Memoised so the derived lists below are not invalidated by a fresh `[]`
  // on every render while no project is open.
  const signs = useMemo(() => project?.signs ?? [], [project])

  const counts = useMemo(() => {
    const type = {}
    const statusCounts = {}
    for (const sign of signs) {
      type[sign.type] = (type[sign.type] ?? 0) + 1
      statusCounts[sign.status] = (statusCounts[sign.status] ?? 0) + 1
    }
    return { type, status: statusCounts }
  }, [signs])

  const types = useMemo(
    () => Object.keys(counts.type).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [counts],
  )

  const visibleSigns = useMemo(() => {
    const query = filters.query.trim().toLowerCase()
    const filtered = signs.filter((sign) => {
      if (filters.types.size && !filters.types.has(sign.type)) return false
      if (filters.statuses.size && !filters.statuses.has(sign.status)) return false
      if (query) {
        const haystack = `${sign.name} ${sign.notes ?? ''}`.toLowerCase()
        if (!haystack.includes(query)) return false
      }
      return true
    })
    return sortSigns(filtered, filters.sort)
  }, [signs, filters])

  const selected = useMemo(
    () => signs.find((sign) => sign.id === selectedId) ?? null,
    [signs, selectedId],
  )

  // On a phone the side pane is shared: the Signs tab always shows the list,
  // and an open sign appears as a sheet over the plan instead. On iPad the
  // tabs are hidden and `tab` stays on "plan", so the pane shows the open sign
  // beside the drawing and falls back to the list when nothing is selected.
  const panelOpen = Boolean(selected) && (wide || tab !== 'list')

  // On a phone the sheet covers the bottom of the plan, so a sign has to be
  // centred in what is left above it.
  const sheetInset = panelOpen && !wide ? SHEET_FRACTION : 0

  // Never zoom out to locate a sign, only in — but the target itself is
  // derived from the plan's own fit scale (see LOCATE_ZOOM_FACTOR), not a
  // fixed number, so it lands at a sensible zoom on any drawing's units.
  const locateScale = useCallback(() => {
    const fit = viewport.scaleToFit(project?.bounds)
    const target = fit ? fit * LOCATE_ZOOM_FACTOR : viewport.view.scale
    return Math.max(viewport.view.scale, target)
  }, [viewport, project?.bounds])

  const locate = useCallback(
    (sign) => {
      if (!sign) return
      viewport.centerOn(sign.x, sign.y, locateScale(), sheetInset)
    },
    [viewport, sheetInset, locateScale],
  )

  const openSign = useCallback(
    (id) => {
      setSelectedId(id)
      setTab('plan')
      const sign = signs.find((s) => s.id === id)
      if (!sign) return
      // The sheet is about to open, so reserve room for it even though
      // `sheetInset` still reflects the previous state this render.
      viewport.centerOn(sign.x, sign.y, locateScale(), wide ? 0 : SHEET_FRACTION)
    },
    [signs, viewport, wide, locateScale],
  )

  // Tapping a marker on the plan opens the sheet over it; nudge the view so the
  // sign stays visible above the sheet.
  const selectFromPlan = useCallback(
    (id) => {
      setSelectedId(id)
      if (wide) return
      const sign = signs.find((s) => s.id === id)
      if (sign) viewport.centerOn(sign.x, sign.y, undefined, SHEET_FRACTION)
    },
    [signs, viewport, wide],
  )

  useEffect(() => {
    if (!menuOpen) return
    const close = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menuOpen])

  const hiddenLayers = useMemo(
    () => new Set((project?.layers ?? []).filter((l) => !l.visible).map((l) => l.name)),
    [project?.layers],
  )
  // Sorted, joined key so the effect below only re-fires when the actual set
  // of hidden layers changes, not on every render.
  const hiddenLayersKey = [...hiddenLayers].sort().join('\n')

  // A layer toggle can hide whatever the view was centred on, leaving the
  // viewport looking empty. Refit to whatever is still visible rather than
  // leaving the user stuck looking at nothing.
  useEffect(() => {
    if (!plan?.layerBounds || !project) return
    const bounds = unionBounds(plan.layerBounds, hiddenLayers) ?? project.bounds
    viewport.fitTo(bounds)
    // hiddenLayersKey is the real dependency; plan/project/viewport are stable
    // references for the life of one open project.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenLayersKey])

  if (status === 'loading') {
    return (
      <div className="screen">
        <p className="muted">Loading…</p>
      </div>
    )
  }

  if (status === 'none' || !project) return <ImportScreen />

  const unexported =
    project.lastExportedAt == null || project.updatedAt - project.lastExportedAt > 60_000

  const addSignAt = (x, y) => {
    const name = prompt('Name for the new sign (e.g. WF_12):', '')
    if (name === null) return
    const sign = actions.addSign({ x, y, name })
    setAddMode(false)
    setSelectedId(sign.id)
    if (!wide) viewport.centerOn(sign.x, sign.y, undefined, SHEET_FRACTION)
  }

  // Aligning the background needs the plan itself free to receive the drag,
  // so entering align mode closes whatever sheet is open (the Background
  // panel included) rather than leaving it covering the plan; "Done aligning"
  // in the toolbar below brings the panel back.
  const startAligning = () => {
    setSheet(null)
    setAddMode(false)
    setAlignMode(true)
  }

  const nudgeUnderlayScale = (factor) => {
    const current = project.underlay?.transform.scale ?? 1
    actions.updateUnderlayTransform({ scale: current * factor })
  }
  const nudgeUnderlayRotation = (delta) => {
    const current = project.underlay?.transform.rotation ?? 0
    actions.updateUnderlayTransform({ rotation: (((current + delta) % 360) + 360) % 360 })
  }

  return (
    <div className="app">
      <header className="bar">
        <div className="bar__title">
          <h1>{project.name}</h1>
          <span className="bar__sub">
            {counts.status.checked ?? 0}/{signs.length} checked
            {unexported && <span className="bar__unsaved"> · not exported</span>}
          </span>
        </div>

        <nav className="bar__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'plan'}
            className={tab === 'plan' ? 'is-on' : ''}
            onClick={() => setTab('plan')}
          >
            Plan
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'list'}
            className={tab === 'list' ? 'is-on' : ''}
            onClick={() => setTab('list')}
          >
            Signs
          </button>
        </nav>

        <div className="bar__menu" ref={menuRef}>
          <button type="button" className="ghost" onClick={() => setMenuOpen((open) => !open)}>
            ⋯
          </button>
          {menuOpen && (
            <ul className="menu">
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setSheet('layers')
                    setMenuOpen(false)
                  }}
                >
                  Layers
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setSheet('background')
                    setMenuOpen(false)
                  }}
                >
                  Background
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => {
                    actions.exportProjectFile()
                    setMenuOpen(false)
                  }}
                >
                  Save project file
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => {
                    actions.exportCsv()
                    setMenuOpen(false)
                  }}
                >
                  Export CSV
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => {
                    actions.exportViewer()
                    setMenuOpen(false)
                  }}
                >
                  Export viewer (HTML)
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => {
                    const next = prompt('Project name:', project.name)
                    if (next?.trim()) actions.renameProject(next.trim())
                    setMenuOpen(false)
                  }}
                >
                  Rename project
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    actions.closeProject()
                  }}
                >
                  Open another plan
                </button>
              </li>
            </ul>
          )}
        </div>
      </header>

      <OfflineNotice />

      {error && (
        <p className="alert" onClick={actions.dismissError} role="alert">
          {error} <span className="alert__dismiss">tap to dismiss</span>
        </p>
      )}

      <main className={`layout layout--${tab}${panelOpen ? ' has-panel' : ''}`}>
        <section className="layout__plan">
          <PlanView
            plan={plan}
            project={project}
            signs={visibleSigns}
            selectedId={selectedId}
            onSelectSign={selectFromPlan}
            addMode={addMode}
            onAddAt={addSignAt}
            viewport={viewport}
            hiddenBlocks={project.hiddenBlocks}
            backdropLayers={project.backdropLayers}
            underlay={underlay}
            underlayMeta={project.underlay}
            alignMode={alignMode}
            onUnderlayDrag={actions.updateUnderlayTransform}
          />

          <div className="plan__tools">
            <button
              type="button"
              onClick={() =>
                viewport.fitTo(unionBounds(plan?.layerBounds, hiddenLayers) ?? project.bounds)
              }
              title="Fit plan"
            >
              ⤢
            </button>
            <button type="button" onClick={() => viewport.zoomBy(1.6)} aria-label="Zoom in">
              +
            </button>
            <button type="button" onClick={() => viewport.zoomBy(1 / 1.6)} aria-label="Zoom out">
              −
            </button>
            {alignMode ? (
              <button
                type="button"
                className="is-on"
                onClick={() => {
                  setAlignMode(false)
                  setSheet('background')
                }}
              >
                Done aligning
              </button>
            ) : (
              <button
                type="button"
                className={addMode ? 'is-on' : ''}
                onClick={() => {
                  setAddMode((on) => !on)
                  setAlignMode(false)
                }}
              >
                {addMode ? 'Tap the plan' : 'Add sign'}
              </button>
            )}
          </div>

          {visibleSigns.length !== signs.length && (
            <p className="plan__note">
              Showing {visibleSigns.length} of {signs.length} signs
            </p>
          )}
        </section>

        <section className="layout__side">
          {panelOpen ? (
            <SignPanel
              sign={selected}
              onClose={() => setSelectedId(null)}
              onLocate={() => {
                locate(selected)
                setTab('plan')
              }}
            />
          ) : (
            <div className="side__list">
              <Progress signs={signs} />
              <Filters filters={filters} onChange={setFilters} types={types} counts={counts} />
              <SignList
                signs={visibleSigns}
                total={signs.length}
                selectedId={selectedId}
                onOpen={openSign}
                onSetStatus={(sign, next) => actions.updateSign(sign.id, { status: next })}
              />
            </div>
          )}
        </section>
      </main>

      {sheet === 'layers' && (
        <div className="overlay" onClick={() => setSheet(null)} role="presentation">
          <div onClick={(event) => event.stopPropagation()} role="presentation">
            <LayerToggle
              layers={project.layers}
              showLabels={project.showLabels}
              onSetLayer={actions.setLayerVisible}
              onSetShowLabels={actions.setShowLabels}
              backdropLayers={project.backdropLayers}
              onSetBackdrop={actions.setBackdropLayer}
              onClose={() => setSheet(null)}
            />
          </div>
        </div>
      )}

      {sheet === 'background' && (
        <div className="overlay" onClick={() => setSheet(null)} role="presentation">
          <div onClick={(event) => event.stopPropagation()} role="presentation">
            <UnderlayPanel
              underlayMeta={project.underlay}
              onSetAlignMode={startAligning}
              onAdd={actions.setUnderlay}
              onRemove={actions.removeUnderlay}
              onSetOpacity={actions.setUnderlayOpacity}
              onNudgeScale={nudgeUnderlayScale}
              onNudgeRotation={nudgeUnderlayRotation}
              onClose={() => setSheet(null)}
            />
          </div>
        </div>
      )}

      {busy && <div className="busy">{busy}</div>}
    </div>
  )
}
