import { and, eq } from 'drizzle-orm'
import { auth, invited } from './config'
import { assertLocalRequest } from '../http/local'
import { db } from '../db'
import { projects, memberships } from '../db/schema'
export class AccessError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}
export interface Actor {
  id: string
  email: string
  local: boolean
  canBuild: boolean
}
export async function actor(request: Request, mutation = false): Promise<Actor> {
  try {
    assertLocalRequest(request, mutation)
  } catch {
    throw new AccessError(403, 'Forbidden origin.')
  }
  if (process.env.FORGE_AUTH_MODE !== 'hosted')
    return {
      id: process.env.FORGE_LOCAL_OWNER_ID || 'local-owner',
      email: '',
      local: true,
      canBuild: true,
    }
  const current = await auth().api.getSession({ headers: request.headers })
  if (!current) throw new AccessError(401, 'Sign in to continue.')
  return {
    id: current.user.id,
    email: current.user.email,
    local: false,
    canBuild: await invited(current.user.email),
  }
}
export async function projectAccess(
  who: Actor,
  id: string,
  level: 'view' | 'comment' | 'owner' = 'view'
) {
  const project = await db().query.projects.findFirst({ where: eq(projects.id, id) })
  if (!project) throw new AccessError(404, 'Project not found.')
  if (project.ownerId === who.id) return project
  if (level === 'owner') throw new AccessError(404, 'Project not found.')
  const member = await db().query.memberships.findFirst({
    where: and(eq(memberships.projectId, id), eq(memberships.userId, who.id)),
  })
  if (!member || (level === 'comment' && member.role !== 'commenter'))
    throw new AccessError(404, 'Project not found.')
  return project
}
export function requireBuilder(who: Actor) {
  if (!who.canBuild) throw new AccessError(403, 'An active beta invitation is required to build.')
}
export function apiError(error: unknown) {
  return Response.json(
    { error: error instanceof AccessError ? error.message : 'The request could not be completed.' },
    { status: error instanceof AccessError ? error.status : 503 }
  )
}
