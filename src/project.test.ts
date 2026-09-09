import { describe, expect, it } from 'vitest'
import { canGenerate, createProjectDraft } from './project.ts'

describe('project draft', () => {
  it('normalizes empty project input', () => {
    expect(createProjectDraft({ name: '  ' })).toEqual({
      name: 'untitled-app',
      prompt: '',
      template: 'Next.js + Postgres',
    })
  })

  it('requires a provider and a meaningful prompt', () => {
    const draft = createProjectDraft({ prompt: 'Build a customer support portal' })
    expect(canGenerate(draft, false)).toBe(false)
    expect(canGenerate(draft, true)).toBe(true)
  })
})
