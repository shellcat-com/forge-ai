import { describe, expect, it } from 'vitest'
import {
  decodeWorkspace,
  emptyWorkspace,
  loadWorkspace,
  saveWorkspace,
  newProject,
} from './storage.ts'
import { createProjectDraft } from './project.ts'
describe('local project persistence', () => {
  it('round trips complete briefs and independent preset versions', () => {
    const data = emptyWorkspace()
    data.projects.push(
      newProject(
        createProjectDraft({
          name: '  Portal  ',
          prompt: 'A customer support portal for a small team',
        }),
        'editorial-product'
      )
    )
    const saved = decodeWorkspace(JSON.stringify(data))
    expect(saved.projects[0].name).toBe('Portal')
    expect(saved.projects[0].presetId).toBe('editorial-product')
    expect(saved.projects[0].presetVersion).toBe(1)
  })
  it('uses an empty workspace only when no record exists', () => {
    expect(decodeWorkspace(null)).toEqual(emptyWorkspace())
    expect(() => decodeWorkspace('')).toThrow()
    expect(() => decodeWorkspace('{')).toThrow()
  })
  it('rejects unsupported versions and malformed records', () => {
    expect(() => decodeWorkspace('{"version":2,"onboarded":false,"projects":[]}')).toThrow()
    const data = emptyWorkspace()
    data.projects.push(newProject(createProjectDraft(), 'technical-mono'))
    const p = data.projects[0]
    expect(() =>
      decodeWorkspace(JSON.stringify({ ...data, projects: [{ ...p, presetId: 'unknown' }] }))
    ).toThrow()
    expect(() =>
      decodeWorkspace(JSON.stringify({ ...data, projects: [{ ...p, createdAt: 'yesterday' }] }))
    ).toThrow()
    expect(() => decodeWorkspace(JSON.stringify({ ...data, projects: [p, p] }))).toThrow()
  })
  it('returns recoverable failures for denied reads and writes', () => {
    const result = loadWorkspace({
      getItem: () => {
        throw new Error('denied')
      },
    })
    expect(result.error).toContain('could not be read')
    expect(result.data.projects).toEqual([])
    expect(
      saveWorkspace(
        {
          setItem: () => {
            throw new Error('quota')
          },
        },
        emptyWorkspace()
      )
    ).toContain('could not be saved')
  })
  it('does not replace corrupt data while loading', () => {
    let writes = 0
    const storage = {
      getItem: () => '{broken',
      setItem: () => {
        writes++
      },
    }
    expect(loadWorkspace(storage).error).not.toBeNull()
    expect(writes).toBe(0)
  })
})
