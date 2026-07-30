import { useEffect, useMemo, useReducer, useRef } from 'react'
import { StoreContext } from './storeContext.js'
import * as db from './db.js'
import { newId } from '../util/id.js'
import { preparePhoto } from '../util/image.js'
import { downloadBlob, exportProject, importProjectFile, signsToCsv } from './persist.js'

/**
 * Projects saved before signs had an editable side list stored photos under a
 * fixed A/B pair. Rebuild that shape on load so old audits keep both slots and
 * every photo stays reachable.
 */
function migrateProject(project) {
  if (!project?.signs?.length) return project
  let changed = false
  const signs = project.signs.map((sign) => {
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
  return changed ? { ...project, signs } : project
}

const AUTOSAVE_DELAY = 400

const initialState = {
  status: 'loading', // loading | none | ready
  project: null,
  plan: null,
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
        const project = migrateProject(projects[0])
        const plan = await db.getPlan(project.id)
        if (cancelled) return
        lastSaved.current = project
        dispatch({ type: 'loaded', project, plan: plan ?? null })
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
      db.putProject(project).catch((error) => dispatch({ type: 'error', error: describe(error) }))
    }, AUTOSAVE_DELAY)
    return () => clearTimeout(saveTimer.current)
  }, [state.project, state.status])

  const actions = useMemo(() => {
    const fail = (error) => dispatch({ type: 'error', error: describe(error) })

    return {
      dismissError: () => dispatch({ type: 'error', error: null }),

      /** Commit a freshly parsed drawing as a new project. */
      async createProject({ name, plan, planFile, signs }) {
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
            signs,
          }
          const planRecord = {
            id,
            fileName: plan.fileName,
            paths: plan.paths,
            labels: plan.labels,
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
          const plan = await db.getPlan(id)
          lastSaved.current = project
          dispatch({ type: 'loaded', project, plan: plan ?? null })
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
          const plan = await db.getPlan(project.id)
          lastSaved.current = project
          dispatch({ type: 'loaded', project, plan: plan ?? null })
        } catch (error) {
          fail(error)
        }
      },

      /** Leave the current project without deleting it, to import another. */
      closeProject: () => dispatch({ type: 'none' }),

      renameProject: (name) => dispatch({ type: 'project', patch: { name } }),
      setShowLabels: (showLabels) => dispatch({ type: 'project', patch: { showLabels } }),
      setLayerVisible: (name, visible) => dispatch({ type: 'setLayerVisible', name, visible }),

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

