export const templates = ['Next.js + Postgres', 'React + Express', 'Vue + FastAPI'] as const

export type Template = (typeof templates)[number]

export interface ProjectDraft {
  name: string
  prompt: string
  template: Template
}

export function createProjectDraft(input: Partial<ProjectDraft> = {}): ProjectDraft {
  return {
    name: input.name?.trim() || 'untitled-app',
    prompt: input.prompt?.trim() || '',
    template: input.template ?? templates[0],
  }
}

export function canGenerate(draft: ProjectDraft, providerConfigured: boolean): boolean {
  return providerConfigured && draft.name.length > 0 && draft.prompt.length >= 20
}
