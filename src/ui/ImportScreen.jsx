import { useEffect, useMemo, useRef, useState } from 'react'
import { buildPlan } from '../dxf/flatten.js'
import { looksLikeDxf, parseDxf } from '../dxf/parse.js'
import {
  analyseInserts,
  bestStrategy,
  candidateStrategies,
  makeSigns,
  nameFor,
  selectedInserts,
  strategyKey,
  strategyLabel,
  suggestSelection,
} from '../dxf/detectSigns.js'
import { useStore } from '../state/storeContext.js'
import OfflineNotice from './OfflineNotice.jsx'
import * as db from '../state/db.js'

/**
 * Import a drawing and confirm which block references are signs.
 *
 * There is no universal CAD convention for how a sign carries its name, so the
 * app scores the possibilities, preselects its best guess, and then shows the
 * names it would produce. Confirming a guess takes one glance; correcting it
 * takes two taps. Guessing silently and being wrong would poison the whole
 * audit.
 */
export default function ImportScreen() {
  const { actions, busy, error } = useStore()
  const dxfInput = useRef(null)
  const projectInput = useRef(null)

  const [parsing, setParsing] = useState(false)
  const [draft, setDraft] = useState(null) // { plan, file, analysis }
  const [selected, setSelected] = useState(() => new Set())
  const [strategy, setStrategy] = useState(null)
  const [name, setName] = useState('')
  const [existing, setExisting] = useState(null)

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
      const plan = buildPlan(parseDxf(text), { fileName: file.name })
      const analysis = analyseInserts(plan.inserts)
      const preselect = new Set(suggestSelection(analysis))
      const chosen = selectedInserts(plan.inserts, preselect)

      setDraft({ plan, file, analysis })
      setSelected(preselect)
      setStrategy(bestStrategy(chosen))
      setName(file.name.replace(/\.dxf$/i, ''))
    } catch (cause) {
      alert(cause.message ?? String(cause))
    } finally {
      setParsing(false)
    }
  }

  const chosenInserts = useMemo(
    () => (draft ? selectedInserts(draft.plan.inserts, selected) : []),
    [draft, selected],
  )

  const strategies = useMemo(() => candidateStrategies(chosenInserts), [chosenInserts])

  const preview = useMemo(() => {
    if (!strategy) return []
    return chosenInserts.slice(0, 6).map((insert, index) => ({
      key: index,
      name: nameFor(insert, strategy).trim() || '(no name — will be numbered)',
    }))
  }, [chosenInserts, strategy])

  const create = () => {
    const signs = makeSigns(draft.plan.inserts, selected, strategy)
    actions.createProject({
      name: name.trim() || 'Signage audit',
      plan: draft.plan,
      planFile: draft.file,
      signs,
    })
  }

  if (draft) {
    const { plan, analysis } = draft
    const unsupported = Object.entries(plan.stats.unsupported)

    return (
      <div className="screen screen--import">
        <div className="card">
          <header className="card__head">
            <h1>Which blocks are signs?</h1>
            <button type="button" className="ghost" onClick={() => setDraft(null)}>
              Start over
            </button>
          </header>

          <p className="muted">
            {plan.stats.entities.toLocaleString()} entities · {plan.layers.length} layers ·{' '}
            {plan.inserts.length.toLocaleString()} block references
            {unsupported.length > 0 && (
              <>
                {' '}
                · skipped{' '}
                {unsupported.map(([type, count]) => `${count}× ${type}`).join(', ')}
              </>
            )}
          </p>

          <section className="card__section">
            <h2>Blocks on the drawing</h2>
            <ul className="blocks">
              {analysis.map((block) => (
                <li key={block.name}>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={selected.has(block.name)}
                      onChange={(event) => {
                        const next = new Set(selected)
                        if (event.target.checked) next.add(block.name)
                        else next.delete(block.name)
                        setSelected(next)
                        setStrategy(bestStrategy(selectedInserts(plan.inserts, next)))
                      }}
                    />
                    <span className="blocks__name">{block.name}</span>
                    <span className="blocks__count">{block.count}</span>
                  </label>
                  {block.tags.length > 0 && (
                    <p className="blocks__tags">
                      attributes: {block.tags.map((t) => t.tag).join(', ')}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="card__section">
            <h2>Where the name comes from</h2>
            <div className="chips">
              {strategies.map((option) => (
                <button
                  key={strategyKey(option)}
                  type="button"
                  className={
                    strategyKey(option) === strategyKey(strategy) ? 'chip is-on' : 'chip'
                  }
                  onClick={() => setStrategy(option)}
                >
                  {strategyLabel(option)}
                </button>
              ))}
            </div>

            <div className="preview">
              <h3>
                {chosenInserts.length.toLocaleString()} sign
                {chosenInserts.length === 1 ? '' : 's'} — names would be
              </h3>
              {preview.length ? (
                <ul>
                  {preview.map((item) => (
                    <li key={item.key}>{item.name}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">Select at least one block above.</p>
              )}
            </div>
          </section>

          <label className="field">
            <span>Project name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>

          <button
            type="button"
            className="primary"
            disabled={!chosenInserts.length || !!busy}
            onClick={create}
          >
            {busy ?? `Create audit with ${chosenInserts.length} signs`}
          </button>
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
