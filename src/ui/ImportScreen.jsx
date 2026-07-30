import { useEffect, useMemo, useRef, useState } from 'react'
import { buildPlan } from '../dxf/flatten.js'
import { looksLikeDxf, parseDxf } from '../dxf/parse.js'
import { auditDxf, describeLosses, reconcile } from '../dxf/audit.js'
import { analyseDrawing, buildSigns, suggestRecipe } from '../dxf/detectSigns.js'
import { unionBounds } from '../dxf/geometry.js'
import { useStore } from '../state/storeContext.js'
import OfflineNotice from './OfflineNotice.jsx'
import PlanView from '../map/PlanView.jsx'
import { useViewport } from '../map/useViewport.js'
import * as db from '../state/db.js'

/**
 * Import a drawing and confirm what on it is a sign.
 *
 * No two signage packages are drawn the same way, so the app proposes a recipe
 * — which blocks are sign symbols, which are data callouts, which attribute is
 * the name — and then *shows the result on the plan* rather than asking anyone
 * to take it on trust. Everything re-runs on each change, so a wrong guess is
 * visible immediately instead of surfacing halfway through a site visit.
 */
export default function ImportScreen() {
  const { actions, busy, error } = useStore()
  const dxfInput = useRef(null)
  const projectInput = useRef(null)
  const viewport = useViewport()

  const [parsing, setParsing] = useState(false)
  const [draft, setDraft] = useState(null) // { plan, dxf, file, analysis, ledger }
  const [recipe, setRecipe] = useState(null)
  const [name, setName] = useState('')
  const [existing, setExisting] = useState(null)
  const [hidden, setHidden] = useState(() => new Set())

  useEffect(() => {
    db.listProjects()
      .then(setExisting)
      .catch(() => setExisting([]))
  }, [])

  const readDxf = async (file) => {
    if (!file) return
    setParsing(true)
    try {
      const text = await file.text()
      if (!looksLikeDxf(text)) {
        throw new Error(
          'That does not look like an ASCII DXF file. If you have a DWG, export it as DXF from your CAD application first.',
        )
      }
      const census = auditDxf(text)
      const dxf = parseDxf(text, census)
      const plan = buildPlan(dxf, { fileName: file.name })
      const analysis = analyseDrawing(dxf, plan)
      const ledger = reconcile(census, plan.stats.rendered, plan.stats.skipped)

      setDraft({ plan, dxf, file, analysis, ledger })
      setRecipe(suggestRecipe(analysis))
      setHidden(new Set())
      setName(file.name.replace(/\.dxf$/i, ''))
    } catch (cause) {
      alert(cause.message ?? String(cause))
    } finally {
      setParsing(false)
    }
  }

  const preview = useMemo(() => {
    if (!draft || !recipe) return { signs: [], links: [], unlinked: 0 }
    return buildSigns(draft.analysis, recipe)
  }, [draft, recipe])

  // Raw block names whose geometry should never be drawn: callouts classified
  // as "data" and not also "marker" — a self-describing block plays both
  // roles and is the visible sign symbol, so it stays on the plan. Keyed off
  // each insert's raw name so dynamic-block variants (`*U22`) are covered
  // alongside the named block they resolve to.
  const hiddenBlocks = useMemo(() => {
    const set = new Set()
    if (!draft || !recipe) return set
    for (const insert of draft.analysis.inserts) {
      if (recipe.tagBlocks.has(insert.effectiveName) && !recipe.markerBlocks.has(insert.effectiveName)) {
        set.add(insert.blockName)
      }
    }
    return set
  }, [draft, recipe])

  // The preview reuses the real plan renderer, so what you approve here is
  // literally what the audit screen will draw.
  const previewProject = useMemo(() => {
    if (!draft) return null
    return {
      id: 'preview',
      bounds: draft.plan.bounds,
      showLabels: true,
      layers: draft.plan.layers.map((l) => ({ ...l, visible: !hidden.has(l.name) })),
    }
  }, [draft, hidden])

  const toggleIn = (set, value) => {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    return next
  }

  const setRole = (blockName, role) =>
    setRecipe((current) => ({
      ...current,
      markerBlocks:
        role === 'marker'
          ? toggleIn(current.markerBlocks, blockName)
          : new Set([...current.markerBlocks].filter((n) => n !== blockName)),
      tagBlocks:
        role === 'data'
          ? toggleIn(current.tagBlocks, blockName)
          : new Set([...current.tagBlocks].filter((n) => n !== blockName)),
    }))

  // A layer toggle can hide whatever the view was centred on. Refit to
  // whatever is still visible rather than leaving the viewport looking empty.
  const hiddenLayersKey = [...hidden].sort().join('\n')
  useEffect(() => {
    if (!draft?.plan?.layerBounds) return
    const bounds = unionBounds(draft.plan.layerBounds, hidden) ?? draft.plan.bounds
    viewport.fitTo(bounds)
    // hiddenLayersKey is the real dependency; draft/viewport are stable for
    // the life of one loaded drawing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenLayersKey])

  const create = () => {
    actions.createProject({
      name: name.trim() || 'Signage audit',
      plan: { ...draft.plan, layers: previewProject.layers },
      planFile: draft.file,
      signs: preview.signs,
      // Persisted so the real audit screen never draws tag-block geometry
      // either — "only used for sign naming" holds for the whole life of the
      // project, not just while setting it up.
      hiddenBlocks: [...hiddenBlocks],
    })
  }

  if (draft && recipe) {
    const { plan, analysis, ledger } = draft
    const lost = describeLosses(ledger)

    return (
      <div className="wizard">
        <header className="wizard__bar">
          <div>
            <h1>What on this drawing is a sign?</h1>
            <p className="muted small">
              {plan.stats.entities.toLocaleString()} entities · {plan.layers.length} layers ·{' '}
              {analysis.leaders.length} leader lines
              {lost && <span className="wizard__lost"> · could not read {lost}</span>}
            </p>
          </div>
          <button type="button" className="ghost" onClick={() => setDraft(null)}>
            Start over
          </button>
        </header>

        <div className="wizard__body">
          <section className="wizard__preview">
            <PlanView
              plan={plan}
              project={previewProject}
              signs={preview.signs}
              selectedId={null}
              onSelectSign={() => {}}
              addMode={false}
              onAddAt={() => {}}
              viewport={viewport}
              hiddenBlocks={hiddenBlocks}
            />
            <div className="plan__tools">
              <button
                type="button"
                title="Fit plan"
                onClick={() => viewport.fitTo(unionBounds(plan.layerBounds, hidden) ?? plan.bounds)}
              >
                ⤢
              </button>
              <button type="button" onClick={() => viewport.zoomBy(1.6)} aria-label="Zoom in">
                +
              </button>
              <button type="button" onClick={() => viewport.zoomBy(1 / 1.6)} aria-label="Zoom out">
                −
              </button>
            </div>
            <p className="plan__note">
              {preview.signs.length} sign{preview.signs.length === 1 ? '' : 's'} ·{' '}
              {preview.links.length} matched to a callout
              {preview.unlinked > 0 && ` · ${preview.unlinked} without one`}
            </p>
          </section>

          <aside className="wizard__side">
            <section className="card__section">
              <h2>Blocks</h2>
              <p className="muted small">
                A <strong>marker</strong> is where the sign physically is. <strong>Data</strong> is
                the callout holding its number. A block can be both.
              </p>
              <ul className="blocks">
                {analysis.blocks.map((block) => (
                  <li key={block.name} className="blocks__row">
                    <div className="blocks__name">
                      {block.name}
                      <span className="blocks__count">×{block.count}</span>
                      {block.variants.length > 0 && (
                        <span className="blocks__meta"> +{block.variants.length} variants</span>
                      )}
                      {block.tags.length > 0 && (
                        <span className="blocks__meta"> {block.tags.join(', ')}</span>
                      )}
                    </div>
                    <div className="blocks__roles">
                      <button
                        type="button"
                        className={recipe.markerBlocks.has(block.name) ? 'chip is-on' : 'chip'}
                        onClick={() => setRole(block.name, 'marker')}
                      >
                        marker
                      </button>
                      <button
                        type="button"
                        className={recipe.tagBlocks.has(block.name) ? 'chip is-on' : 'chip'}
                        onClick={() => setRole(block.name, 'data')}
                        disabled={!block.tags.length}
                      >
                        data
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {analysis.attributeTags.length > 0 && (
              <section className="card__section">
                <h2>Sign name comes from</h2>
                <div className="chips">
                  {analysis.attributeTags.map((tag) => (
                    <button
                      key={tag.tag}
                      type="button"
                      className={recipe.nameTag === tag.tag ? 'chip is-on' : 'chip'}
                      onClick={() => setRecipe((c) => ({ ...c, nameTag: tag.tag }))}
                    >
                      {tag.tag}
                      <span className="chip__count">{tag.distinct}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {analysis.looseLayers.length > 0 && (
              <section className="card__section">
                <h2>Signs drawn without a block</h2>
                <p className="muted small">
                  Circles marked with a centre point. Their position is used; how many faces they
                  have is set per sign afterwards.
                </p>
                <ul className="layers">
                  {analysis.looseLayers.map((entry) => (
                    <li key={entry.layer}>
                      <label className="toggle">
                        <input
                          type="checkbox"
                          checked={recipe.looseLayers.has(entry.layer)}
                          onChange={() =>
                            setRecipe((c) => ({ ...c, looseLayers: toggleIn(c.looseLayers, entry.layer) }))
                          }
                        />
                        <span className="layers__name">
                          {entry.layer}
                          <span className="blocks__meta"> {entry.withCentreMark} circles</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="card__section">
              <h2>Layers</h2>
              <ul className="layers">
                {plan.layers.map((layer) => (
                  <li key={layer.name}>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={!hidden.has(layer.name)}
                        onChange={() => setHidden((h) => toggleIn(h, layer.name))}
                      />
                      <span className="layers__swatch" style={{ background: layer.color }} />
                      <span className="layers__name">{layer.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>

            <label className="field">
              <span>Project name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>

            <button
              type="button"
              className="primary"
              disabled={!preview.signs.length || !!busy}
              onClick={create}
            >
              {busy ?? `Start audit with ${preview.signs.length} signs`}
            </button>
          </aside>
        </div>
      </div>
    )
  }

  return (
    <div className="screen screen--import">
      <div className="card">
        <h1>Signage Audit</h1>
        <p className="muted">
          Load a CAD plan, walk the site, and record notes and photos against every sign.
        </p>

        <OfflineNotice />

        {error && <p className="alert">{error}</p>}

        <div className="card__actions">
          <button
            type="button"
            className="primary"
            onClick={() => dxfInput.current?.click()}
            disabled={parsing}
          >
            {parsing ? 'Reading drawing…' : 'Open a DXF plan'}
          </button>
          <button type="button" onClick={() => projectInput.current?.click()} disabled={!!busy}>
            {busy ?? 'Open a saved project file'}
          </button>
        </div>

        <p className="muted small">
          DXF only. If your plans are DWG, export them as DXF from AutoCAD or BricsCAD first — DWG
          is a binary format no browser can read.
        </p>

        <input
          ref={dxfInput}
          type="file"
          accept=".dxf,application/dxf,image/vnd.dxf,text/plain"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            readDxf(file)
          }}
        />
        <input
          ref={projectInput}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) actions.importProjectFile(file)
          }}
        />

        {existing?.length > 0 && (
          <section className="card__section">
            <h2>On this device</h2>
            <ul className="projects">
              {existing.map((project) => (
                <li key={project.id}>
                  <button type="button" onClick={() => actions.openProject(project.id)}>
                    <strong>{project.name}</strong>
                    <span>
                      {project.signs?.length ?? 0} signs ·{' '}
                      {new Date(project.updatedAt).toLocaleDateString()}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    aria-label={`Delete ${project.name}`}
                    onClick={() => {
                      if (confirm(`Delete "${project.name}" and all its photos?`)) {
                        actions.deleteProject(project.id)
                      }
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
