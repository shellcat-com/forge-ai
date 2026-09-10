export interface ProjectSummary {
  id: string
  name: string
  brief: string
  ownerId: string
  archived: boolean
  starred: boolean
  lastOpenedAt: string
  updatedAt: string
  design: { style: string; exampleId?: string; preserve: string }
  activeRevision: string | null
}
export interface ProjectDetail {
  permissions?: { build: boolean; comment: boolean }
  project: ProjectSummary
  messages: { id: string; role: string; mode: string; content: string; createdAt: string }[]
  history: { id: string; summary: string; createdAt: string }[]
  files: Record<string, string>
  protectedFiles: Record<string, string>
  jobs: {
    id: string
    kind: string
    prompt: string
    status: string
    error: string | null
    provider: string
    runId?: string
    model: string
  }[]
  previewReady: boolean
  previewUrl: string
}
export interface TimelineEvent {
  id: number
  type: string
  message: string
}
export interface ModelChoice {
  provider: 'gemini' | 'groq' | 'ollama' | 'openrouter' | 'byok'
  model: string
}
