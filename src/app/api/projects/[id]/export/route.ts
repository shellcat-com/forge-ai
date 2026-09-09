import { strToU8, zipSync } from 'fflate'
import { actor, projectAccess, apiError, AccessError } from '../../../../../server/auth/access'
import { projectDetail } from '../../../../../server/projects/service'
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const who = await actor(request)
    const { id } = await context.params
    await projectAccess(who, id, 'owner')
    const detail = await projectDetail(id)
    if (!detail) throw new AccessError(404, 'Project not found.')
    const entries: Record<string, Uint8Array> = {}
    for (const [name, content] of Object.entries({ ...detail.protectedFiles, ...detail.files }))
      entries[name] = strToU8(content)
    entries['FORGE-EXPORT.md'] = strToU8(
      `# ${detail.project.name}\n\nSource export of revision ${detail.project.activeRevision || 'draft'}. Credentials and customer data are excluded. Build using the included package lock and supported Node version.\n`
    )
    return new Response(zipSync(entries).slice().buffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="forge-${id}.zip"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    return apiError(e)
  }
}
