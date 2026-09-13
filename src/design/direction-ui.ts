import { escapeHTML as e, preview } from '../components/ui.ts'
import { getPreset, presets } from './presets.ts'
import { customDirection, isCustomDesign, readDirection, type DesignDirection } from './direction.ts'
import './direction.css'

export function directionFields(selected: string, direction: DesignDirection = customDirection(), presetName = 'preset'): string {
  return `<section class="design-direction"><h2>Make it your own.</h2><p>Describe any app or website style. Presets are optional starting points.</p><fieldset class="direction-modes"><legend>How would you like to start?</legend><label><input type="radio" name="designMode" value="custom" ${direction.mode === 'custom' ? 'checked' : ''}><span>My own design</span></label><label><input type="radio" name="designMode" value="preset" ${direction.mode === 'preset' ? 'checked' : ''}><span>Start from a preset</span></label></fieldset><div data-direction-custom ${direction.mode === 'preset' ? 'hidden' : ''}><label>Your style <span class="muted">(optional)</span><textarea name="designStyle" maxlength="1500" rows="4" placeholder="A playful learning app, a warm editorial shop, a bold brutalist portfolio…">${e(direction.style)}</textarea></label><label>Design references <span class="muted">(optional)</span><textarea name="designReferences" maxlength="1000" rows="2" placeholder="Website URLs, brand guidelines, or details you want to combine">${e(direction.references)}</textarea></label><p class="field-help">Describe what you like about each reference. Links are saved as inspiration; their contents are not imported.</p><a href="#/design-library">Browse more inspiration ↗</a></div><fieldset class="preset-options" data-direction-presets ${direction.mode === 'custom' ? 'hidden' : ''}><legend>Optional preset</legend>${presets.map(p => `<label><input type="radio" name="${e(presetName)}" value="${p.id}" ${p.id === selected ? 'checked' : ''}><span><strong>${p.name}</strong><small>${p.description}</small></span><span class="radio-mark"></span></label>`).join('')}</fieldset></section>`
}

export function directionPreview(prompt: string, presetId: string, mode = 'light', compact = false): string {
  if (!isCustomDesign(prompt)) return preview(presetId, mode, undefined, compact)
  const direction = readDirection(prompt).direction!
  return `<div class="custom-design-preview ${compact ? 'compact' : ''}"><span class="eyebrow">YOUR OWN DIRECTION</span>${compact ? '' : `<h2>Room for your ideas.</h2><p>${e(direction.style || 'Let the brief guide an original design: layout, typography, colors and interactions are open to your ideas.')}</p><p>${e(direction.references)}</p><small>Your design notes are saved with the brief. Generate a frontend with a configured provider to see the result.</small>`}</div>`
}
export const directionName = (prompt: string, preset: string): string => isCustomDesign(prompt) ? 'Custom design' : getPreset(preset).name

/** Update only dependent controls, keeping unsaved form values and focus intact. */
export function updateDirectionForm(form: HTMLFormElement): void {
  const custom = new FormData(form).get('designMode') !== 'preset'
  const customFields = form.querySelector<HTMLElement>('[data-direction-custom]')
  const presetFields = form.querySelector<HTMLElement>('[data-direction-presets]')
  if (customFields) customFields.hidden = !custom
  if (presetFields) presetFields.hidden = custom
  const themeButton = form.querySelector<HTMLButtonElement>('[data-action=preview-theme]')
  if (themeButton) themeButton.disabled = custom
}
