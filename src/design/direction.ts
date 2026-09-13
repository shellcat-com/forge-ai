/** Design intent travels with the brief through existing local and account APIs. */
export interface DesignDirection {
  mode: 'custom' | 'preset'
  style: string
  references: string
}
const start = '\n\n[Forge design direction]\n'
const end = '\n[/Forge design direction]'
export const customDirection = (): DesignDirection => ({ mode: 'custom', style: '', references: '' })

export function readDirection(text: string): { brief: string; direction: DesignDirection | null } {
  const index = text.lastIndexOf(start)
  if (index >= 0 && text.endsWith(end)) {
    try {
      const value = JSON.parse(text.slice(index + start.length, -end.length))
      if ((value.mode === 'custom' || value.mode === 'preset') && typeof value.style === 'string' && typeof value.references === 'string')
        return { brief: text.slice(0, index), direction: { mode: value.mode, style: value.style, references: value.references } }
    } catch { /* An unrecognized block is ordinary user text. */ }
  }
  return { brief: text, direction: null }
}

export function writeDirection(brief: string, direction: DesignDirection, limit = 12000): string {
  if (direction.style.length > 1500 || direction.references.length > 1000)
    throw new Error('Keep style notes under 1,500 characters and references under 1,000 characters.')
  const result = brief.trim() + start + JSON.stringify({
    ...direction,
    instruction: direction.mode === 'custom'
      ? 'Create an original design from this brief and style notes. Built-in presets do not constrain the design. References are inspiration; their contents have not been fetched.'
      : 'Use the selected preset as a starting point; adapt it to the brief.',
  }) + end
  if (result.length > limit) throw new Error(`Shorten the brief or design notes. Together they must fit within ${limit.toLocaleString('en-US')} characters.`)
  return result
}

export function directionFromForm(values: FormData): DesignDirection {
  return {
    mode: values.get('designMode') === 'preset' ? 'preset' : 'custom',
    style: String(values.get('designStyle') || '').trim(),
    references: String(values.get('designReferences') || '').trim(),
  }
}
export const isCustomDesign = (prompt: string): boolean => readDirection(prompt).direction?.mode === 'custom'

export function readableBrief(prompt: string): string {
  const { brief, direction } = readDirection(prompt)
  return direction ? [brief, `Design direction: ${direction.mode === 'custom' ? 'Custom design' : 'Optional preset'}`, direction.style, direction.references].filter(Boolean).join('\n\n') : brief
}
