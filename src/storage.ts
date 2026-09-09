import { templates, createProjectDraft, type ProjectDraft } from './project.ts'
import { isPresetId, type PresetId } from './design/presets.ts'
export interface ProjectRecord extends ProjectDraft {
  id: string
  presetId: PresetId
  presetVersion: number
  createdAt: string
  updatedAt: string
}
export interface WorkspaceData {
  version: 1
  onboarded: boolean
  projects: ProjectRecord[]
}
export interface StoreResult {
  data: WorkspaceData
  error: string | null
}
export const storageKey = 'forge.workspace.v1'
export const emptyWorkspace = (): WorkspaceData => ({ version: 1, onboarded: false, projects: [] })
function validProject(value: unknown): value is ProjectRecord {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  return (
    typeof p.id === 'string' &&
    /^[a-zA-Z0-9-]+$/.test(p.id) &&
    typeof p.name === 'string' &&
    p.name.length > 0 &&
    p.name.length <= 100 &&
    typeof p.prompt === 'string' &&
    p.prompt.length <= 12000 &&
    templates.includes(p.template as (typeof templates)[number]) &&
    isPresetId(p.presetId) &&
    p.presetVersion === 1 &&
    typeof p.createdAt === 'string' &&
    Number.isFinite(Date.parse(p.createdAt)) &&
    typeof p.updatedAt === 'string' &&
    Number.isFinite(Date.parse(p.updatedAt))
  )
}
export function decodeWorkspace(raw: string | null): WorkspaceData {
  if (raw === null) return emptyWorkspace()
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object') throw new Error('Invalid workspace')
  const data = value as WorkspaceData
  if (
    data.version !== 1 ||
    typeof data.onboarded !== 'boolean' ||
    !Array.isArray(data.projects) ||
    !data.projects.every(validProject) ||
    new Set(data.projects.map((p) => p.id)).size !== data.projects.length
  )
    throw new Error('Unsupported or damaged workspace')
  return data
}
export function loadWorkspace(storage: Pick<Storage, 'getItem'>): StoreResult {
  try {
    return { data: decodeWorkspace(storage.getItem(storageKey)), error: null }
  } catch {
    return {
      data: emptyWorkspace(),
      error:
        'Your saved workspace could not be read. Retry, download a backup, or reset local data in Settings. New changes stay in memory until recovery.',
    }
  }
}
export function saveWorkspace(
  storage: Pick<Storage, 'setItem'>,
  data: WorkspaceData
): string | null {
  try {
    decodeWorkspace(JSON.stringify(data))
    storage.setItem(storageKey, JSON.stringify(data))
    return null
  } catch {
    return 'Changes are available in this tab, but could not be saved in this browser. Free some storage or download your briefs in Settings.'
  }
}
export function newProject(input: ProjectDraft, presetId: PresetId): ProjectRecord {
  const now = new Date().toISOString()
  return {
    ...createProjectDraft(input),
    id: crypto.randomUUID(),
    presetId,
    presetVersion: 1,
    createdAt: now,
    updatedAt: now,
  }
}
