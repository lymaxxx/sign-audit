import { useEffect, useMemo, useReducer, useRef } from 'react'
import { StoreContext } from './storeContext.js'
import * as db from './db.js'
import { newId } from '../util/id.js'
import { preparePhoto } from '../util/image.js'
import { downloadBlob, exportProject, importProjectFile, signsToCsv } from './persist.js'
import { exportViewerHtml } from '../export/viewer.js'
import { renderPdfPage } from '../underlay/pdf.js'
import { buildDxfUnderlay } from '../underlay/dxfUnderlay.js'

/**
 * Projects saved before signs had an editable side list stored photos under a
 * fixed A/B pair. Rebuild that shape on load so old audits keep both slots and
 * every photo stays reachable.
 */
function migrateProject(project) {
  if (!project) return project
  let changed = false
  let signs = project.signs

  if (project.signs?.length) {
    signs = project.signs.map((sign) => {
      if (Array.isArray(sign.sides)) return sign
      changed = true
      const legacy = sign.photos ?? {}
      return {
        ...sign,
        sides: [
          { id: 'A', bearing: sign.rotation ?? 0 },
          { id: 'B', bearing: ((sign.rotation ?? 0) + 180) % 360 },
        ],
        photos: { A: legacy.A ?? [], B: legacy.B ?? [] },
        data: sign.data ?? {},
      }
    })
  }

  // Projects saved before tag/callout blocks were tracked separately have
  // nothing to hide — harmless no-op, not "show everything that used to be
  // hidden", since there was no such concept yet.
  if (!Array.isArray(project.hiddenBlocks)) {
    changed = true
  }

  // Same reasoning for backdrop layers: nothing was ever marked as passive
  // background before this existed, so an empty list is the correct default,
  // not a guess.
  if (!Array.isArray(project.backdropLayers)) {
    changed = true
  }

  return changed
    ? {
        ...project,
        signs,
        hiddenBlocks: project.hiddenBlocks ?? [],
        backdropLayers: project.backdropLayers ?? [],
      }
    : project
}

/**
 * A starting position/scale for a freshly attached underlay, so it lands
 * somewhere sane rather than at its own file's raw coordinate origin (which,
 * for a PDF rendered in pixels, could be many thousand units away from a plan
 * measured in metres).
 *
 * `x`/`y` are the world-space position of the underlay's own centre — see
 * `underlayCentre` in `underlay/geometry.js` — so this only has to decide a
 * centre and a scale, not a full placement.
 */
function guessUnderlayTransform(project, payload) {
  const target = project?.crop ?? project?.bounds ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 }
  const targetW = Math.max(target.maxX - target.minX, 1e-9)
  const targetH = Math.max(target.maxY - target.minY, 1e-9)
  const scale =
    payload.kind === 'image' ? Math.max(targetW / payload.width, targetH / payload.height) || 1 : 1
  return { x: (target.minX + target.maxX) / 2, y: (target.minY + target.maxY) / 2, scale, rotation: 0 }
}

/**
 * Prefer the crash-recovery journal when it describes the same project and is
 * newer than what IndexedDB has.
 *
 * A stale journal — one left behind by a save that did land — is ignored on
 * the `updatedAt` comparison rather than trusted blindly, so recovering can
 * never roll an audit backwards.
 */
function recoverNewest(stored, recovered) {
  if (!recovered || recovered.id !== stored?.id) return stored
  return (recovered.updatedAt ?? 0) > (stored.updatedAt ?? 0) ? recovered : stored
}

// Short enough that the window where work exists only in memory is negligible,
// long enough to coalesce a burst of keystrokes. Cheap because the project
// record holds no blobs — the baked drawing, the original file and the photos
// live in their own stores and are never rewritten by autosave.
const AUTOSAVE_DELAY = 150

const initialState = {
  status: 'loading', // loading | none | ready
  project: null,
  plan: null,
  // The heavy underlay payload (an image blob or a second drawing's baked
  // geometry) — kept apart from `project.underlay`, which is just its
  // position/opacity, the same split as `plan` vs. `project.bounds`.
  underlay: null,
  error: null,
  busy: null,
}

function patchSign(signs, id, patch) {
  // Type comes from the layer the sign was found on, so renaming a sign no
  // longer reclassifies it — a correction to a sign's number should not quietly
  // move it into a different filter group.
  return signs.map((sign) =>
    sign.id === id ? { ...sign, ...patch, updatedAt: Date.now() } : sign,
  )
}

function reducer(state, action) {
  switch (action.type) {
    case 'loading':
      return { ...state, status: 'loading', error: null }

    case 'none':
      return { ...initialState, status: 'none' }

    case 'loaded':
      return {
        status: 'ready',
        project: action.project,
        plan: action.plan,
        underlay: action.underlay ?? null,
        error: null,
        busy: null,
      }

    case 'busy':
      return { ...state, busy: action.busy, error: action.busy ? null : state.error }

    case 'error':
      return { ...state, busy: null, error: action.error }

    case 'project':
      if (!state.project) return state
      return { ...state, project: { ...state.project, ...action.patch, updatedAt: Date.now() } }

    case 'updateSign':
      if (!state.project) return state
      return {
        ...state,
        project: {
          ...state.project,
          signs: patchSign(state.project.signs, action.id, action.patch),
          updatedAt: Date.now(),
        },
      }

    case 'addSign':
      if (!state.project) return state
      return {
        ...state,
        project: {
          ...state.project,
          signs: [...state.project.signs, action.sign],
          updatedAt: Date.now(),
        },
      }

    case 'removeSign':
      if (!state.project) return state
      return {
        ...state,
        project: {
          ...state.project,
          signs: state.project.signs.filter((s) => s.id !== action.id),
          updatedAt: Date.now(),
        },
      }

    case 'setLayerVisible':
      if (!state.project) return state
      return {
        ...state,
        project: {
          ...state.project,
          layers: state.project.layers.map((l) =>
            l.name === action.name ? { ...l, visible: action.visible } : l,
          ),
          updatedAt: Date.now(),
        },
      }

    case 'setBackdropLayer':
      if (!state.project) return state
      return {
        ...state,
        project: {
          ...state.project,
          backdropLayers: action.on
            ? [...new Set([...state.project.backdropLayers, action.name])]
            : state.project.backdropLayers.filter((name) => name !== action.name),
          updatedAt: Date.now(),
        },
      }

    case 'setUnderlay':
      if (!state.project) return state
      return {
        ...state,
        project: { ...state.project, underlay: action.meta, updatedAt: Date.now() },
        underlay: action.payload,
      }

    case 'removeUnderlay':
      if (!state.project) return state
      return {
        ...state,
        project: { ...state.project, underlay: null, updatedAt: Date.now() },
        underlay: null,
      }

    case 'updateUnderlayMeta':
      if (!state.project?.underlay) return state
      return {
        ...state,
        project: {
          ...state.project,
          underlay: { ...state.project.underlay, ...action.patch },
          updatedAt: Date.now(),
        },
      }

    case 'updateUnderlayTransform':
      if (!state.project?.underlay) return state
      return {
        ...state,
        project: {
          ...state.project,
          underlay: {
            ...state.project.underlay,
            transform: { ...state.project.underlay.transform, ...action.patch },
          },
          updatedAt: Date.now(),
        },
      }

    default:
      return state
  }
}

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const saveTimer = useRef(null)
  const lastSaved = useRef(null)

  // Load the most recently touched project on start-up, and ask the browser to
  // exempt this origin from storage eviction while we are at it.
  useEffect(() => {
    let cancelled = false
    db.requestPersistence()
    ;(async () => {
      try {
        const projects = await db.listProjects()
        if (cancelled) return
        if (!projects.length) {
          dispatch({ type: 'none' })
          return
        }
        const project = migrateProject(recoverNewest(projects[0], db.readRecovery()))
        const [plan, underlay] = await Promise.all([db.getPlan(project.id), db.getUnderlay(project.id)])
        if (cancelled) return
        // Deliberately not marked as already-saved: whatever came out of the
        // journal still has to reach IndexedDB, and leaving it unsaved lets
        // the autosave effect do exactly that on the next tick.
        lastSaved.current = null
        dispatch({ type: 'loaded', project, plan: plan ?? null, underlay: underlay ?? null })
      } catch (error) {
        if (!cancelled) dispatch({ type: 'error', error: describe(error) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Autosave. Only the mutable project record is written; the baked drawing
  // and the photo blobs live in their own stores and never change after import.
  useEffect(() => {
    const project = state.project
    if (state.status !== 'ready' || !project || project === lastSaved.current) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      lastSaved.current = project
      db.putProject(project)
        // The journal only exists to cover what autosave had not written yet.
        .then(() => db.clearRecovery())
        .catch((error) => dispatch({ type: 'error', error: describe(error) }))
    }, AUTOSAVE_DELAY)
    return () => clearTimeout(saveTimer.current)
  }, [state.project, state.status])

  /**
   * Write immediately when the page is being hidden.
   *
   * The debounce above exists so typing a note does not hit the database on
   * every keystroke, but it also means the last few hundred milliseconds of
   * work are still only in memory. On a phone that is the exact moment the
   * work is most likely to be lost: switching apps, locking the screen or
   * pulling down the share sheet can all let iOS discard the page without
   * warning, and there is no second chance to save afterwards. `pagehide` and
   * the hidden `visibilitychange` are the last events guaranteed to run, so
   * the pending write is flushed there rather than waited on.
   */
  useEffect(() => {
    const flush = () => {
      const project = state.project
      if (state.status !== 'ready' || !project || project === lastSaved.current) return
      // Synchronous on purpose. An IndexedDB write started here never
      // completes — the browser discards the transaction as the page goes —
      // so the unsaved state goes to the recovery journal instead, and the
      // next start-up picks it up. See db.saveRecovery.
      db.saveRecovery(project)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [state.project, state.status])

  const actions = useMemo(() => {
    const fail = (error) => dispatch({ type: 'error', error: describe(error) })

    return {
      dismissError: () => dispatch({ type: 'error', error: null }),

      /** Commit a freshly parsed drawing as a new project. */
      async createProject({ name, plan, planFile, signs, hiddenBlocks, backdropLayers, crop }) {
        dispatch({ type: 'busy', busy: 'Saving project…' })
        try {
          const id = newId('prj')
          const project = {
            id,
            name,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            lastExportedAt: null,
            planFileName: plan.fileName,
            bounds: plan.bounds,
            layers: plan.layers,
            showLabels: true,
            // Tag/callout block names never drawn on this project's plan —
            // "only used for sign naming" holds for its whole life, not just
            // while setting it up.
            hiddenBlocks: hiddenBlocks ?? [],
            // Layers marked passive background (an XREF'd wall shell, say) —
            // drawn dimmed and without labels rather than as foreground content.
            backdropLayers: backdropLayers ?? [],
            // The region of the drawing this audit covers, when the user
            // narrowed it down at import. Null means the whole drawing.
            crop: crop ?? null,
            signs,
          }
          const planRecord = {
            id,
            fileName: plan.fileName,
            paths: plan.paths,
            labels: plan.labels,
            layerBounds: plan.layerBounds,
            stats: plan.stats,
          }
          await db.putPlan(planRecord)
          if (planFile) await db.putPlanFile(id, planFile)
          await db.putProject(project)
          lastSaved.current = project
          dispatch({ type: 'loaded', project, plan: planRecord })
          db.requestPersistence()
        } catch (error) {
          fail(error)
        }
      },

      async openProject(id) {
        dispatch({ type: 'loading' })
        try {
          const project = migrateProject(await db.getProject(id))
          if (!project) {
            dispatch({ type: 'none' })
            return
          }
          const [plan, underlay] = await Promise.all([db.getPlan(id), db.getUnderlay(id)])
          lastSaved.current = project
          dispatch({ type: 'loaded', project, plan: plan ?? null, underlay: underlay ?? null })
        } catch (error) {
          fail(error)
        }
      },

      async deleteProject(id) {
        try {
          await db.deleteProject(id)
          const remaining = await db.listProjects()
          if (!remaining.length) {
            lastSaved.current = null
            dispatch({ type: 'none' })
            return
          }
          const project = migrateProject(remaining[0])
          const [plan, underlay] = await Promise.all([db.getPlan(project.id), db.getUnderlay(project.id)])
          lastSaved.current = project
          dispatch({ type: 'loaded', project, plan: plan ?? null, underlay: underlay ?? null })
        } catch (error) {
          fail(error)
        }
      },

      /** Leave the current project without deleting it, to import another. */
      closeProject: () => dispatch({ type: 'none' }),

      renameProject: (name) => dispatch({ type: 'project', patch: { name } }),
      setShowLabels: (showLabels) => dispatch({ type: 'project', patch: { showLabels } }),
      setLayerVisible: (name, visible) => dispatch({ type: 'setLayerVisible', name, visible }),
      setBackdropLayer: (name, on) => dispatch({ type: 'setBackdropLayer', name, on }),

      /**
       * Attach a PDF page or a second DXF as a background reference behind
       * the plan. `type` is 'pdf' or 'dxf'; `pageNumber` is only meaningful
       * for a PDF and defaults to its first page.
       */
      async setUnderlay({ file, type, pageNumber = 1 }) {
        dispatch({ type: 'busy', busy: type === 'pdf' ? 'Rendering page…' : 'Reading drawing…' })
        try {
          const project = state.project
          const payload =
            type === 'pdf'
              ? { id: project.id, kind: 'image', ...(await renderPdfPage(file, pageNumber)) }
              : { id: project.id, kind: 'dxf', ...buildDxfUnderlay(await file.text()) }
          await db.putUnderlay(payload)
          const meta = { type, opacity: 0.6, transform: guessUnderlayTransform(project, payload) }
          dispatch({ type: 'setUnderlay', meta, payload })
          dispatch({ type: 'busy', busy: null })
        } catch (error) {
          fail(error)
        }
      },

      async removeUnderlay() {
        await db.deleteUnderlay(state.project.id).catch(() => {})
        dispatch({ type: 'removeUnderlay' })
      },

      setUnderlayOpacity: (opacity) => dispatch({ type: 'updateUnderlayMeta', patch: { opacity } }),
      updateUnderlayTransform: (patch) => dispatch({ type: 'updateUnderlayTransform', patch }),

      updateSign: (id, patch) => dispatch({ type: 'updateSign', id, patch }),

      addSign({ x, y, name, type }) {
        const clean = (name ?? '').trim() || 'NEW_SIGN'
        const sign = {
          id: newId('sgn'),
          name: clean,
          // Signs added on site have no layer to take a type from, so they land
          // in their own group until the user says otherwise.
          type: type ?? 'Added on site',
          x,
          y,
          rotation: 0,
          blockName: null,
          layer: null,
          source: 'added',
          // Signs added on site are proposals until someone decides otherwise.
          status: 'proposed',
          notes: '',
          sides: [{ id: 'A', bearing: 0 }],
          data: {},
          photos: {},
          updatedAt: Date.now(),
        }
        dispatch({ type: 'addSign', sign })
        return sign
      },

      async removeSign(id, sign) {
        for (const ids of Object.values(sign?.photos ?? {})) {
          for (const photoId of ids ?? []) {
            await db.deletePhoto(photoId).catch(() => {})
          }
        }
        dispatch({ type: 'removeSign', id })
      },

      async addPhoto(sign, side, file) {
        dispatch({ type: 'busy', busy: 'Processing photo…' })
        try {
          const prepared = await preparePhoto(file)
          const photo = {
            id: newId('pho'),
            projectId: state.project.id,
            signId: sign.id,
            side,
            blob: prepared.blob,
            thumb: prepared.thumb,
            width: prepared.width,
            height: prepared.height,
            takenAt: Date.now(),
          }
          await db.putPhoto(photo)
          dispatch({
            type: 'updateSign',
            id: sign.id,
            patch: {
              photos: { ...sign.photos, [side]: [...(sign.photos?.[side] ?? []), photo.id] },
            },
          })
          dispatch({ type: 'busy', busy: null })
        } catch (error) {
          fail(error)
        }
      },

      async removePhoto(sign, side, photoId) {
        await db.deletePhoto(photoId).catch(() => {})
        dispatch({
          type: 'updateSign',
          id: sign.id,
          patch: {
            photos: {
              ...sign.photos,
              [side]: (sign.photos?.[side] ?? []).filter((id) => id !== photoId),
            },
          },
        })
      },

      async exportProjectFile() {
        dispatch({ type: 'busy', busy: 'Building project file…' })
        try {
          const project = state.project
          const [planFile, photos] = await Promise.all([
            db.getPlanFile(project.id),
            db.getPhotosForProject(project.id),
          ])
          const { blob, fileName } = await exportProject(
            project,
            state.plan,
            planFile?.blob ?? null,
            photos,
          )
          downloadBlob(blob, fileName)
          dispatch({ type: 'project', patch: { lastExportedAt: Date.now() } })
          dispatch({ type: 'busy', busy: null })
        } catch (error) {
          fail(error)
        }
      },

      exportCsv() {
        const project = state.project
        const csv = signsToCsv(project.signs)
        downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${project.name}.csv`)
      },

      /** A read-only viewer for someone who does not have this app. */
      async exportViewer() {
        dispatch({ type: 'busy', busy: 'Building viewer…' })
        try {
          const project = state.project
          const photos = await db.getPhotosForProject(project.id)
          const { blob, fileName } = await exportViewerHtml(project, state.plan, photos)
          downloadBlob(blob, fileName)
          dispatch({ type: 'busy', busy: null })
        } catch (error) {
          fail(error)
        }
      },

      async importProjectFile(file) {
        dispatch({ type: 'busy', busy: 'Opening project file…' })
        try {
          const { project, plan, planFile, photos } = await importProjectFile(file)
          if (plan) await db.putPlan(plan)
          if (planFile) await db.putPlanFile(project.id, planFile)
          for (const photo of photos) await db.putPhoto(photo)
          await db.putProject(project)
          lastSaved.current = project
          dispatch({ type: 'loaded', project, plan: plan ?? null })
          db.requestPersistence()
        } catch (error) {
          fail(error)
        }
      },
    }
    // `state.project` and `state.plan` are read inside async actions; rebuilding
    // the action object when they change keeps those reads current.
  }, [state.project, state.plan])

  const value = useMemo(() => ({ ...state, actions }), [state, actions])
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

function describe(error) {
  if (error?.name === 'QuotaExceededError') {
    return 'The device is out of storage for this app. Export the project, then remove some photos.'
  }
  return error?.message ?? String(error)
}

