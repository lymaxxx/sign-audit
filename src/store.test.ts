import { describe, expect, it } from 'vitest'
import { useStore, resolveTemplateId, resolveTemplate, type Project } from './store'
import { createDefaultTemplate } from './model/defaults'
import { emptyTimetable } from './model/types'

const projectWithTemplates = (): Project => ({
  name: 'Test',
  timetable: emptyTimetable(),
  templates: [
    { id: 'a', name: 'A', template: createDefaultTemplate() },
    { id: 'b', name: 'B', template: createDefaultTemplate() },
  ],
  defaultTemplateId: 'a',
  edits: {},
})

describe('resolveTemplateId', () => {
  it('falls back to the project default when a stop has no assignment', () => {
    const project = projectWithTemplates()
    expect(resolveTemplateId(project, 'stop1')).toBe('a')
  })

  it('honours a stop-specific assignment', () => {
    const project = projectWithTemplates()
    project.edits.stop1 = { templateId: 'b' }
    expect(resolveTemplateId(project, 'stop1')).toBe('b')
  })

  it('falls back to the default when the assigned template no longer exists', () => {
    const project = projectWithTemplates()
    project.edits.stop1 = { templateId: 'ghost' }
    expect(resolveTemplateId(project, 'stop1')).toBe('a')
  })

  it('resolves to the default even with no stop given', () => {
    const project = projectWithTemplates()
    expect(resolveTemplateId(project, null)).toBe('a')
  })
})

describe('resolveTemplate', () => {
  it('returns the actual template object for the resolved id', () => {
    const project = projectWithTemplates()
    project.edits.stop1 = { templateId: 'b' }
    expect(resolveTemplate(project, 'stop1')).toBe(project.templates[1]!.template)
  })
})

describe('the template library actions', () => {
  it('adding a template makes it active and keeps the rest untouched', () => {
    const before = useStore.getState().project.templates.length
    const id = useStore.getState().addTemplate('Extra')
    const state = useStore.getState()
    expect(state.project.templates).toHaveLength(before + 1)
    expect(state.activeTemplateId).toBe(id)
    expect(state.project.templates.find((t) => t.id === id)?.name).toBe('Extra')
  })

  it('deleting a template falls stops assigned to it back to the default', () => {
    const id = useStore.getState().addTemplate('Temporary')
    useStore.getState().assignStopTemplate('s1', id)
    expect(useStore.getState().project.edits.s1?.templateId).toBe(id)

    useStore.getState().deleteTemplate(id)
    const state = useStore.getState()
    expect(state.project.templates.some((t) => t.id === id)).toBe(false)
    expect(state.project.edits.s1?.templateId).toBeUndefined()
  })

  it('refuses to delete the last remaining template', () => {
    const state = useStore.getState()
    // Whittle down to one template, then confirm the last one survives.
    const extras = state.project.templates.filter((t) => t.id !== state.project.defaultTemplateId)
    for (const t of extras) useStore.getState().deleteTemplate(t.id)
    expect(useStore.getState().project.templates).toHaveLength(1)

    const onlyId = useStore.getState().project.templates[0]!.id
    useStore.getState().deleteTemplate(onlyId)
    expect(useStore.getState().project.templates).toHaveLength(1)
  })
})
