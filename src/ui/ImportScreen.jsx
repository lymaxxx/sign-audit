import { useEffect, useMemo, useRef, useState } from 'react'
import { buildPlan, describeUnresolvedInserts } from '../dxf/flatten.js'
import { looksLikeDxf, parseDxf } from '../dxf/parse.js'
import { auditDxf, describeLosses, emptyLayers, reconcile } from '../dxf/audit.js'
import { cropDxf, isUsableBox } from '../dxf/crop.js'
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
  const [backdrop, setBackdrop] = useState(() => new Set())
  const [crop, setCrop] = useState(null)
  const [cropMode, setCropMode] = useState(false)

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

      // The raw document is kept so narrowing to a region can re-derive
      // everything from it — cropping filters entities before anything is
      // baked or detected, so it cannot be applied to an already-built plan.
      setDraft({ dxf, file, census })
      setCrop(null)
      setRecipe(suggestRecipe(analysis))
      setHidden(new Set())
      // An XREF is background context by convention — the walls of the
      // building the signs live in, not something to audit — so a layer named
      // for one is worth defaulting to backdrop rather than making every
      // import re-discover the same toggle.
      setBackdrop(new Set(plan.layers.filter((l) => /xref/i.test(l.name)).map((l) => l.name)))
      setName(file.name.replace(/\.dxf$/i, ''))
    } catch (cause) {
      alert(cause.message ?? String(cause))
    } finally {
      setParsing(false)
    }
  }

  // Everything downstream of the crop, rebuilt whenever the region changes so
  // the geometry, the layer list, the sign list and the bounds all describe
  // the same scope.
  const derived = useMemo(() => {
    if (!draft) return null
    const cropped = cropDxf(draft.dxf, crop)
    const plan = buildPlan(cropped, { fileName: draft.file.name })
    return {
      plan,
      analysis: analyseDrawing(cropped, plan),
      ledger: reconcile(draft.census, plan.stats.rendered, plan.stats.skipped),
      blank: emptyLayers(draft.census, plan),
    }
  }, [draft, crop])

  const preview = useMemo(() => {
    if (!derived || !recipe) return { signs: [], links: [], unlinked: 0 }
    return buildSigns(derived.analysis, recipe)
  }, [derived, recipe])

  // Raw block names whose geometry should never be drawn: callouts classified
  // as "data" and not also "marker" — a self-describing block plays both
  // roles and is the visible sign symbol, so it stays on the plan. Keyed off
  // each insert's raw name so dynamic-block variants (`*U22`) are covered
  // alongside the named block they resolve to.
  const hiddenBlocks = useMemo(() => {
    const set = new Set()
    if (!derived || !recipe) return set
    for (const insert of derived.analysis.inserts) {
      if (recipe.tagBlocks.has(insert.effectiveName) && !recipe.markerBlocks.has(insert.effectiveName)) {
        set.add(insert.blockName)
      }
    }
    // Leaders that connect a marker to one of those now-hidden tags would
    // otherwise dangle on the plan, pointing at nothing.
    for (const handle of preview.leaderHandles ?? []) set.add(`leader:${handle}`)
    return set
  }, [derived, recipe, preview.leaderHandles])

  // The preview reuses the real plan renderer, so what you approve here is
  // literally what the audit screen will draw.
  const previewProject = useMemo(() => {
    if (!derived) return null
    return {
      id: 'preview',
      bounds: derived.plan.bounds,
      crop,
      showLabels: true,
      layers: derived.plan.layers.map((l) => ({ ...l, visible: !hidden.has(l.name) })),
    }
  }, [derived, hidden, crop])

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
  // Narrowing the region is the same problem, so both drive the same refit.
  const hiddenLayersKey = [...hidden].sort().join('\n')
  const cropKey = crop ? `${crop.minX},${crop.minY},${crop.maxX},${crop.maxY}` : ''
  useEffect(() => {
    if (!derived?.plan?.layerBounds) return
    if (crop) {
      viewport.fitTo(crop)
      return
    }
    viewport.fitTo(unionBounds(derived.plan.layerBounds, hidden) ?? derived.plan.bounds)
    // hiddenLayersKey/cropKey are the real dependencies; derived/viewport are
    // stable for the life of one loaded drawing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenLayersKey, cropKey])

  const applyCrop = (box) => {
    setCropMode(false)
    // A stray tap rather than a deliberate drag: leave the scope alone.
    if (isUsableBox(box)) setCrop(box)
  }

  const create = () => {
    actions.createProject({
      name: name.trim() || 'Signage audit',
      plan: { ...derived.plan, layers: previewProject.layers },
      planFile: draft.file,
      signs: preview.signs,
      // Persisted so the real audit screen never draws tag-block geometry
      // either — "only used for sign naming" holds for the whole life of the
      // project, not just while setting it up.
      hiddenBlocks: [...hiddenBlocks],
      backdropLayers: [...backdrop],
      crop,
    })
  }

  if (draft && recipe && derived) {
    const { plan, analysis, ledger, blank } = derived
    const lost = describeLosses(ledger)
    const unresolved = describeUnresolvedInserts(plan.stats.unresolvedInserts)

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
            {unresolved && <p className="muted small wizard__lost">{unresolved}</p>}
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
              backdropLayers={backdrop}
              cropMode={cropMode}
              onCropDrawn={applyCrop}
            />
            <div className="plan__tools">
              <button
                type="button"
                title="Fit plan"
                onClick={() =>
                  viewport.fitTo(crop ?? unionBounds(plan.layerBounds, hidden) ?? plan.bounds)
                }
              >
                ⤢
              </button>
              <button type="button" onClick={() => viewport.zoomBy(1.6)} aria-label="Zoom in">
                +
              </button>
              <button type="button" onClick={() => viewport.zoomBy(1 / 1.6)} aria-label="Zoom out">
                −
              </button>
              <button
                type="button"
                className={cropMode ? 'is-on' : ''}
                title="Audit only part of this drawing"
                onClick={() => setCropMode((on) => !on)}
              >
                {cropMode ? 'Drag a box' : '⧉'}
              </button>
            </div>
            <p className="plan__note">
              {preview.signs.length} sign{preview.signs.length === 1 ? '' : 's'} ·{' '}
              {preview.links.length} matched to a callout
              {preview.unlinked > 0 && ` · ${preview.unlinked} without one`}
              {crop && ' · region only'}
            </p>
          </section>

          <aside className="wizard__side">
            <section className="card__section">
              <h2>Area of interest</h2>
              <p className="muted small">
                A drawing often carries far more than the job — neighbouring buildings, a key
                plan, other floors. Narrow it down and everything below, the sign list and the
                exported results all cover only that region.
              </p>
              {crop ? (
                <div className="crop">
                  <span className="crop__state">
                    Region set · {Math.round(crop.maxX - crop.minX).toLocaleString()} ×{' '}
                    {Math.round(crop.maxY - crop.minY).toLocaleString()} units
                  </span>
                  <div className="crop__actions">
                    <button type="button" className="chip" onClick={() => setCropMode(true)}>
                      Redraw
                    </button>
                    <button type="button" className="chip" onClick={() => setCrop(null)}>
                      Use whole drawing
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className={cropMode ? 'chip is-on' : 'chip'}
                  onClick={() => setCropMode((on) => !on)}
                >
                  {cropMode ? 'Now drag a box on the plan…' : 'Select an area on the plan'}
                </button>
              )}
            </section>

            {blank.length > 0 && (
              <section className="card__section">
                <h2>Layers that drew nothing</h2>
                <p className="muted small">
                  These layers are named in the file but produced no geometry. A layer whose
                  entities are all inside block definitions — or that has none at all — was never
                  in this DXF to draw: that is what an external reference looks like when it was
                  not bound before export.
                </p>
                <ul className="layers">
                  {blank.map((row) => (
                    <li key={row.layer}>
                      <span className="layers__name">
                        {row.layer}
                        <span className="blocks__meta">
                          {' '}
                          {row.inModelSpace} in model space, {row.inBlocks} inside blocks
                          {row.neverInModelSpace && ' — nothing to draw'}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

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
                <p className="muted small">
                  Pick one or more, in the order they should join — e.g. sign code then sequence
                  number gives names like <code>D101.2_606</code>.
                </p>
                <div className="chips">
                  {analysis.attributeTags.map((tag) => {
                    const position = recipe.nameTags.indexOf(tag.tag)
                    return (
                      <button
                        key={tag.tag}
                        type="button"
                        className={position >= 0 ? 'chip is-on' : 'chip'}
                        onClick={() =>
                          setRecipe((c) => {
                            if (c.nameTags.includes(tag.tag)) {
                              // Always leave at least one attribute selected —
                              // an empty name source is a broken state, not a
                              // valid preference.
                              if (c.nameTags.length === 1) return c
                              return { ...c, nameTags: c.nameTags.filter((t) => t !== tag.tag) }
                            }
                            return { ...c, nameTags: [...c.nameTags, tag.tag] }
                          })
                        }
                      >
                        {position >= 0 && recipe.nameTags.length > 1 && (
                          <span className="chip__order">{position + 1}</span>
                        )}
                        {tag.tag}
                        <span className="chip__count">{tag.distinct}</span>
                      </button>
                    )
                  })}
                </div>
              </section>
            )}

            {analysis.looseLayers.length > 0 && (
              <section className="card__section">
                <h2>Signs drawn without a block</h2>
                <p className="muted small">
                  Circles or rectangles marked with a centre point — separate lines and letters,
                  not a block. Their position is used; how many faces they have and which way each
                  one points is set per sign afterwards.
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
                          <span className="blocks__meta"> {entry.withCentreMark} shapes</span>
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

            <section className="card__section">
              <h2>Backdrop layers</h2>
              <p className="muted small">
                Passive background context — an XREF'd wall shell, say — drawn dim and without its
                own text, behind everything else. Separate from visibility above: a layer can be
                shown but demoted to backdrop, or hidden entirely.
              </p>
              <ul className="layers">
                {plan.layers.map((layer) => (
                  <li key={layer.name}>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={backdrop.has(layer.name)}
                        onChange={() => setBackdrop((b) => toggleIn(b, layer.name))}
                      />
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
