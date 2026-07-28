import { create } from 'zustand'
import type { MasterTemplate, VectorItem, ZoneId } from './model/template'
import { createDefaultTemplate } from './model/defaults'
import { emptyTimetable, type Timetable } from './model/types'
import { makeDemoTimetable } from './model/demo'
import type { StopEdits } from './model/sheet'
import type { ImportIssue } from './import/types'

/**
 * Application state.
 *
 * The timetable and the template are held apart on purpose: importing a fresh
 * season of data replaces the first and leaves the second — and every per-stop
 * edit layered over it — exactly as it was.
 */

export interface Project {
  name: string
  timetable: Timetable
  template: MasterTemplate
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

export interface AppState {
  project: Project
  selection: Selection
  history: History
  issues: ImportIssue[]
  showGuides: boolean
  zoom: number | 'fit'
  inspectorTab: InspectorTab
  busy: string | null

  select: (stopId: string) => void
  selectItem: (zone: ZoneId | null, itemId: string | null) => void
  setInspectorTab: (tab: InspectorTab) => void
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
  applyTemplate: (template: MasterTemplate) => void
  loadProject: (project: Project) => void
  newProject: () => void

  editsFor: (stopId: string) => StopEdits
  updateEdits: (stopId: string, mutate: (edits: StopEdits) => void) => void
  addZoneItem: (zone: ZoneId, item: VectorItem) => void
  removeZoneItem: (zone: ZoneId, itemId: string) => void
}

export type InspectorTab = 'artboard' | 'flow' | 'zones' | 'type' | 'colour' | 'rules' | 'stop'

const HISTORY_LIMIT = 60

/**
 * Snapshot a project for the undo stack.
 *
 * Only the template and the per-stop edits are copied. The timetable is
 * replaced wholesale on import and never mutated in place, so it can be shared
 * between every history entry — and it is by far the largest thing here. Deep
 * copying it turned a keystroke in a text field into two clones of a Map
 * holding thousands of departure arrays, which is what made typing crawl.
 */
const clone = (project: Project): Project => ({
  name: project.name,
  timetable: project.timetable,
  template: structuredClone(project.template),
  edits: structuredClone(project.edits),
})

const demoProject = (): Project => {
  const timetable = makeDemoTimetable()
  return {
    name: 'Demo corridor',
    timetable,
    template: createDefaultTemplate(),
    edits: {},
  }
}

const blankProject = (): Project => ({
  name: 'Untitled',
  timetable: emptyTimetable(),
  template: createDefaultTemplate(),
  edits: {},
})

export const useStore = create<AppState>((set, get) => ({
  // Opening onto sample data beats opening onto an empty window: the layout
  // controls mean nothing until there is something laid out.
  project: demoProject(),
  selection: { stopId: 's1', zone: null, itemId: null },
  history: { past: [], future: [] },
  issues: [],
  showGuides: false,
  zoom: 'fit',
  inspectorTab: 'artboard',
  busy: null,

  select: (stopId) => set((s) => ({ selection: { ...s.selection, stopId, itemId: null, zone: null } })),
  selectItem: (zone, itemId) => set((s) => ({ selection: { ...s.selection, zone, itemId } })),
  setInspectorTab: (inspectorTab) => set({ inspectorTab }),
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
      draft.template = template
    }),

  loadProject: (project) =>
    set({
      project,
      selection: { stopId: project.timetable.stops[0]?.id ?? null, zone: null, itemId: null },
      history: { past: [], future: [] },
      issues: [],
    }),

  newProject: () =>
    set({
      project: blankProject(),
      selection: { stopId: null, zone: null, itemId: null },
      history: { past: [], future: [] },
      issues: [],
    }),

  editsFor: (stopId) => get().project.edits[stopId] ?? {},

  updateEdits: (stopId, mutate) =>
    get().commit('Edit stop', (draft) => {
      draft.edits[stopId] ??= {}
      mutate(draft.edits[stopId]!)
    }),

  addZoneItem: (zone, item) =>
    get().commit('Add item', (draft) => {
      draft.template.zones[zone].items.push(item)
    }),

  removeZoneItem: (zone, itemId) =>
    get().commit('Remove item', (draft) => {
      const z = draft.template.zones[zone]
      z.items = z.items.filter((i) => i.id !== itemId)
    }),
}))

export { demoProject, blankProject }
