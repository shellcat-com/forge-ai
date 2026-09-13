// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { customDirection, directionFromForm, readDirection, readableBrief, writeDirection } from './direction.ts'
import { directionFields, directionPreview, updateDirectionForm } from './direction-ui.ts'
import { projectForm, projectList } from '../pages/workspace.ts'
import { newProject, decodeWorkspace } from '../storage.ts'

describe('open design direction', () => {
  it('defaults new projects to freeform while keeping explicit preset links', () => {
    document.body.innerHTML = projectForm([])
    expect(document.querySelector<HTMLInputElement>('[name=designMode]:checked')?.value).toBe('custom')
    expect(document.querySelector<HTMLElement>('[data-direction-presets]')?.hidden).toBe(true)
    document.body.innerHTML = projectForm([], 'editorial-product')
    expect(document.querySelector<HTMLInputElement>('[name=designMode]:checked')?.value).toBe('preset')
    expect(document.querySelector<HTMLInputElement>('[name=preset]:checked')?.value).toBe('editorial-product')
  })
  it('retains arbitrary designs through persistence, edit and exported JSON', () => {
    const direction = { ...customDirection(), style: 'A botanical music sequencer with handwritten notation', references: 'https://example.com/design and my brand guide' }
    const prompt = writeDirection('Build a musical playground for beginners.', direction)
    const record = newProject({ name: 'Sound garden', prompt, template: 'React + Express' }, 'technical-mono')
    const workspace = decodeWorkspace(JSON.stringify({ version: 1, onboarded: true, projects: [record] }))
    document.body.innerHTML = projectForm(workspace.projects, record.presetId, record)
    const values = new FormData(document.querySelector('form')!)
    expect(directionFromForm(values)).toEqual(direction)
    expect(values.get('prompt')).toBe('Build a musical playground for beginners.')
    expect(writeDirection(String(values.get('prompt')), directionFromForm(values))).toBe(prompt)
    expect(projectList(workspace)).toContain('Custom design')
    expect(directionPreview(prompt, record.presetId)).not.toContain('project-preview')
    expect(readableBrief(prompt)).not.toContain('[Forge design direction]')
  })
  it('keeps unsaved values when switching between custom and presets', () => {
    document.body.innerHTML = `<form>${directionFields('technical-mono')}</form>`
    const form = document.querySelector('form')!
    const notes = form.elements.namedItem('designStyle') as HTMLTextAreaElement
    notes.value = 'Iridescent type and a magazine grid'
    const radio = form.querySelector<HTMLInputElement>('[name=designMode][value=preset]')!
    radio.checked = true; updateDirectionForm(form)
    expect(form.querySelector<HTMLElement>('[data-direction-custom]')?.hidden).toBe(true)
    form.querySelector<HTMLInputElement>('[name=designMode][value=custom]')!.checked = true
    updateDirectionForm(form)
    expect(directionFromForm(new FormData(form)).style).toBe(notes.value)
  })
  it('escapes notes and preserves legacy and malformed briefs', () => {
    const direction = { ...customDirection(), style: '</textarea><script>alert(1)</script>' }
    document.body.innerHTML = directionFields('technical-mono', direction) + directionPreview(writeDirection('Example brief.', direction), 'technical-mono')
    expect(document.querySelector('script')).toBeNull()
    for (const brief of ['My existing idea.', 'Idea\n\n[Forge design direction]\nnot JSON\n[/Forge design direction]'])
      expect(readDirection(brief)).toEqual({ brief, direction: null })
  })
  it('retains onboarding direction across feature edits and rejects oversized combined text', () => {
    const features = writeDirection('Calendar and chat', { ...customDirection(), style: 'Art deco' }, 4000)
    const next = writeDirection('Calendar, chat, and search', readDirection(features).direction!, 4000)
    const completed = `Audience: students\nOutcome: collaboration\nCore features: ${next}`
    expect(readDirection(completed).direction?.style).toBe('Art deco')
    expect(() => writeDirection('a'.repeat(4000), customDirection(), 4000)).toThrow('Shorten')
    expect(() => writeDirection('a'.repeat(12000), customDirection())).toThrow('Shorten')
  })
})
