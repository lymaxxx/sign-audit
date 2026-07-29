import { create } from 'zustand'
import type { MasterTemplate, VectorItem, ZoneId } from './model/template'
import { createDefaultTemplate } from './model/defaults'
import { emptyTimetable, type Route, type Timetable } from './model/types'
import { makeDemoTimetable } from './model/demo'
import type { StopEdits } from './model/sheet'
import type { ImportIssue } from './import/types'

/**
 * Application state.
 *
 * The timetable and the templates are held apart on purpose: importing a
 * fresh season of data replaces the first and leaves the second — and every
 * per-stop edit layered over it — exactly as it was.
 */

export interface NamedTemplate {
  id: string
  name: string
  template: MasterTemplate
}

export interface Project {
  name: string
  timetable: Timetable
  /** Every master template the project knows, at least one. */
  templates: NamedTemplate[]
  /** Which one a stop uses when it does not say otherwise. */
  defaultTemplateId: string
  edits: Record<string, StopEdits>
}

export interface Selection {
  stopId: string | null
  /** A vector item being edited in one of the bands. */
  zone: ZoneId | null
  itemId: string | null
}

interface History {
  past: Project[]
  future: Project[]
}

const randomId = (prefix: string): string => `${prefix}-${Math.random().toString(36).slice(2, 8)}`

/** The template a stop's sheet is actually built from. */
export const resolveTemplateId = (project: Project, stopId: string | null): string => {
  const wanted = stopId ? project.edits[stopId]?.templateId : undefined
  if (wanted && project.templates.some((t) => t.id === wanted)) return wanted
  if (project.templates.some((t) => t.id === project.defaultTemplateId)) return project.defaultTemplateId
  return project.templates[0]!.id
}

export const resolveTemplate = (project: Project, stopId: string | null): MasterTemplate =>
  (project.templates.find((t) => t.id === resolveTemplateId(project, stopId)) ?? project.templates[0]!).template

/** The template the Inspector is editing and the canvas is previewing. */
export const useActiveTemplate = (): MasterTemplate => {
  const templates = useStore((s) => s.project.templates)
  const activeId = useStore((s) => s.activeTemplateId)
  return templates.find((t) => t.id === activeId)?.template ?? templates[0]!.template
}

export interface AppState {
  project: Project
  selection: Selection
  history: History
  issues: ImportIssue[]
  showGuides: boolean
  zoom: number | 'fit'
  inspectorTab: InspectorTab
  /** Which of the two lists the left panel shows — stops or the route roster
   *  they are drawn from. */
  sidebarTab: SidebarTab
  /** The template the Inspector edits and the canvas previews. Follows the
   *  selected stop's own template automatically; picking a template to edit
   *  directly in the template library overrides that until the selection
   *  changes again. */
  activeTemplateId: string
  busy: string | null

  select: (stopId: string) => void
  selectItem: (zone: ZoneId | null, itemId: string | null) => void
  setInspectorTab: (tab: InspectorTab) => void
  setSidebarTab: (tab: SidebarTab) => void
  setActiveTemplateId: (id: string) => void
  setZoom: (zoom: number | 'fit') => void
  toggleGuides: () => void
  setBusy: (message: string | null) => void
  setIssues: (issues: ImportIssue[]) => void

  /** Change the project and push the previous state onto the undo stack. */
  commit: (label: string, mutate: (draft: Project) => void) => void
  /** Change without recording history — for dragging, where every mouse move
   *  would otherwise become its own undo step. */
  touch: (mutate: (draft: Project) => void) => void
  /** Record the current state before a run of `touch` calls begins. */
  beginGesture: () => void

  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean

  replaceTimetable: (timetable: Timetable, issues: ImportIssue[]) => void
  mergeTimetable: (timetable: Timetable, issues: ImportIssue[]) => void
  /** Replace the active template's own settings, in place — used when a
   *  `.tgentpl` file is loaded onto whichever template is being edited. */
  applyTemplate: (template: MasterTemplate) => void
  loadProject: (project: Project) => void
  newProject: () => void

  /** A fresh, unnamed template, made active for editing. Returns its id. */
  addTemplate: (name: string) => string
  /** A copy of an existing template, made active for editing. Returns its id. */
  duplicateTemplate: (id: string) => string
  renameTemplate: (id: string, name: string) => void
  /** Refuses to remove the last remaining template. Stops pointed at the
   *  removed one fall back to the project default. */
  deleteTemplate: (id: string) => void
  setDefaultTemplate: (id: string) => void
  /** Unset to fall back to the project default. */
  assignStopTemplate: (stopId: string, templateId: string | null) => void

  editsFor: (stopId: string) => StopEdits
  updateEdits: (stopId: string, mutate: (edits: StopEdits) => void) => void
  addZoneItem: (zone: ZoneId, item: VectorItem) => void
  /** Edit a line's own presentation — its colour, headsign, streets. */
  updateRoute: (routeId: string, mutate: (route: Route) => void) => void
  /** Move a line up or down the roster. Sheets list routes in this order, so
   *  this is how a network decides which line leads a shelter. */
  moveRoute: (routeId: string, delta: number) => void
  removeZoneItem: (zone: ZoneId, itemId: string) => void
}

export type InspectorTab =
  | 'artboard'
  | 'flow'
  | 'zones'
  | 'type'
  | 'colour'
  | 'rules'
  | 'templates'
  | 'stop'

export type SidebarTab = 'stops' | 'routes'

const HISTORY_LIMIT = 60

/**
 * Snapshot a project for the undo stack.
 *
 * Only the templates and the per-stop edits are copied. The timetable is
 * replaced wholesale on import and never mutated in place, so it can be shared
 * between every history entry — and it is by far the largest thing here. Deep
 * copying it turned a keystroke in a text field into two clones of a Map
 * holding thousands of departure arrays, which is what made typing crawl.
 */
const clone = (project: Project): Project => ({
  name: project.name,
  timetable: project.timetable,
  templates: project.templates.map((t) => ({ ...t, template: structuredClone(t.template) })),
  defaultTemplateId: project.defaultTemplateId,
  edits: structuredClone(project.edits),
})

const singleTemplateProject = (name: string, timetable: Timetable): Project => {
  const id = randomId('template')
  return {
    name,
    timetable,
    templates: [{ id, name: 'Default', template: createDefaultTemplate() }],
    defaultTemplateId: id,
    edits: {},
  }
}

const demoProject = (): Project => singleTemplateProject('Demo corridor', makeDemoTimetable())
const blankProject = (): Project => singleTemplateProject('Untitled', emptyTimetable())

const initialProject = demoProject()

export const useStore = create<AppState>((set, get) => ({
  // Opening onto sample data beats opening onto an empty window: the layout
  // controls mean nothing until there is something laid out.
  project: initialProject,
  selection: { stopId: 's1', zone: null, itemId: null },
  history: { past: [], future: [] },
  issues: [],
  showGuides: false,
  zoom: 'fit',
  inspectorTab: 'artboard',
  sidebarTab: 'stops',
  activeTemplateId: resolveTemplateId(initialProject, 's1'),
  busy: null,

  select: (stopId) =>
    set((s) => ({
      selection: { ...s.selection, stopId, itemId: null, zone: null },
      activeTemplateId: resolveTemplateId(s.project, stopId),
    })),
  selectItem: (zone, itemId) => set((s) => ({ selection: { ...s.selection, zone, itemId } })),
  setInspectorTab: (inspectorTab) => set({ inspectorTab }),
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
  setActiveTemplateId: (activeTemplateId) => set({ activeTemplateId }),
  setZoom: (zoom) => set({ zoom }),
  toggleGuides: () => set((s) => ({ showGuides: !s.showGuides })),
  setBusy: (busy) => set({ busy }),
  setIssues: (issues) => set({ issues }),

  commit: (_label, mutate) =>
    set((s) => {
      const previous = clone(s.project)
      const next = clone(s.project)
      mutate(next)
      return {
        project: next,
        history: {
          past: [...s.history.past, previous].slice(-HISTORY_LIMIT),
          future: [],
        },
      }
    }),

  touch: (mutate) =>
    set((s) => {
      const next = clone(s.project)
      mutate(next)
      return { project: next }
    }),

  beginGesture: () =>
    set((s) => ({
      history: { past: [...s.history.past, clone(s.project)].slice(-HISTORY_LIMIT), future: [] },
    })),

  undo: () =>
    set((s) => {
      const previous = s.history.past.at(-1)
      if (!previous) return {}
      return {
        project: previous,
        history: {
          past: s.history.past.slice(0, -1),
          future: [clone(s.project), ...s.history.future].slice(0, HISTORY_LIMIT),
        },
      }
    }),

  redo: () =>
    set((s) => {
      const next = s.history.future[0]
      if (!next) return {}
      return {
        project: next,
        history: {
          past: [...s.history.past, clone(s.project)].slice(-HISTORY_LIMIT),
          future: s.history.future.slice(1),
        },
      }
    }),

  canUndo: () => get().history.past.length > 0,
  canRedo: () => get().history.future.length > 0,

  replaceTimetable: (timetable, issues) =>
    set((s) => {
      const next = clone(s.project)
      next.timetable = timetable
      // Edits are keyed by stop, so they survive as long as the stop does.
      const live = new Set(timetable.stops.map((stop) => stop.id))
      next.edits = Object.fromEntries(Object.entries(next.edits).filter(([id]) => live.has(id)))
      const stopId = timetable.stops[0]?.id ?? null
      return {
        project: next,
        issues,
        selection: { stopId, zone: null, itemId: null },
        activeTemplateId: resolveTemplateId(next, stopId),
        history: { past: [...s.history.past, clone(s.project)].slice(-HISTORY_LIMIT), future: [] },
      }
    }),

  mergeTimetable: (timetable, issues) =>
    set((s) => {
      const next = clone(s.project)
      const old = s.project.timetable

      // A fresh timetable rather than an edit in place: history entries share
      // this object, so mutating it would rewrite the past as well.
      const byId = <T extends { id: string }>(existing: T[], incoming: T[]): T[] => {
        const seen = new Set(existing.map((x) => x.id))
        return [...existing, ...incoming.filter((x) => !seen.has(x.id))]
      }

      next.timetable = {
        routes: byId(old.routes, timetable.routes),
        stops: byId(old.stops, timetable.stops),
        dayTypes: byId(old.dayTypes, timetable.dayTypes),
        // Later imports win for a given route, stop and kind of day.
        departures: new Map([...old.departures, ...timetable.departures]),
      }

      return {
        project: next,
        issues,
        history: { past: [...s.history.past, clone(s.project)].slice(-HISTORY_LIMIT), future: [] },
      }
    }),

  applyTemplate: (template) =>
    get().commit('Apply template', (draft) => {
      const active = get().activeTemplateId
      const entry = draft.templates.find((t) => t.id === active)
      if (entry) entry.template = template
    }),

  loadProject: (project) =>
    set({
      project,
      selection: { stopId: project.timetable.stops[0]?.id ?? null, zone: null, itemId: null },
      activeTemplateId: resolveTemplateId(project, project.timetable.stops[0]?.id ?? null),
      history: { past: [], future: [] },
      issues: [],
    }),

  newProject: () => {
    const project = blankProject()
    set({
      project,
      selection: { stopId: null, zone: null, itemId: null },
      activeTemplateId: project.defaultTemplateId,
      history: { past: [], future: [] },
      issues: [],
    })
  },

  addTemplate: (name) => {
    const id = randomId('template')
    get().commit('New template', (draft) => {
      draft.templates.push({ id, name, template: createDefaultTemplate() })
    })
    set({ activeTemplateId: id })
    return id
  },

  duplicateTemplate: (sourceId) => {
    const id = randomId('template')
    get().commit('Duplicate template', (draft) => {
      const source = draft.templates.find((t) => t.id === sourceId)
      if (!source) return
      draft.templates.push({ id, name: `${source.name} copy`, template: structuredClone(source.template) })
    })
    set({ activeTemplateId: id })
    return id
  },

  renameTemplate: (id, name) =>
    get().commit('Rename template', (draft) => {
      const entry = draft.templates.find((t) => t.id === id)
      if (entry) entry.name = name
    }),

  deleteTemplate: (id) => {
    if (get().project.templates.length <= 1) return
    get().commit('Delete template', (draft) => {
      draft.templates = draft.templates.filter((t) => t.id !== id)
      if (draft.defaultTemplateId === id) draft.defaultTemplateId = draft.templates[0]!.id
      for (const edits of Object.values(draft.edits)) {
        if (edits.templateId === id) delete edits.templateId
      }
    })
    if (get().activeTemplateId === id) set({ activeTemplateId: get().project.defaultTemplateId })
  },

  setDefaultTemplate: (id) =>
    get().commit('Set default template', (draft) => {
      if (draft.templates.some((t) => t.id === id)) draft.defaultTemplateId = id
    }),

  assignStopTemplate: (stopId, templateId) =>
    get().commit('Assign template', (draft) => {
      draft.edits[stopId] ??= {}
      if (templateId) draft.edits[stopId]!.templateId = templateId
      else delete draft.edits[stopId]!.templateId
    }),

  editsFor: (stopId) => get().project.edits[stopId] ?? {},

  updateEdits: (stopId, mutate) =>
    get().commit('Edit stop', (draft) => {
      draft.edits[stopId] ??= {}
      mutate(draft.edits[stopId]!)
    }),

  updateRoute: (routeId, mutate) =>
    get().commit('Edit route', (draft) => {
      // Routes live in the timetable, which history entries share, so this one
      // case has to replace rather than mutate.
      draft.timetable = {
        ...draft.timetable,
        routes: draft.timetable.routes.map((r) => {
          if (r.id !== routeId) return r
          const copy = structuredClone(r)
          mutate(copy)
          return copy
        }),
      }
    }),

  moveRoute: (routeId, delta) =>
    get().commit('Reorder routes', (draft) => {
      const from = draft.timetable.routes.findIndex((r) => r.id === routeId)
      if (from < 0) return
      const to = from + delta
      if (to < 0 || to >= draft.timetable.routes.length) return

      // Same care updateRoute takes: history entries share the timetable, so
      // the array is replaced rather than spliced in place.
      const routes = [...draft.timetable.routes]
      const [moved] = routes.splice(from, 1)
      routes.splice(to, 0, moved!)
      draft.timetable = { ...draft.timetable, routes }
    }),

  addZoneItem: (zone, item) =>
    get().commit('Add item', (draft) => {
      const entry = draft.templates.find((t) => t.id === get().activeTemplateId)
      if (entry) entry.template.zones[zone].items.push(item)
    }),

  removeZoneItem: (zone, itemId) =>
    get().commit('Remove item', (draft) => {
      const entry = draft.templates.find((t) => t.id === get().activeTemplateId)
      if (!entry) return
      const z = entry.template.zones[zone]
      z.items = z.items.filter((i) => i.id !== itemId)
    }),
}))

export { demoProject, blankProject, singleTemplateProject }
