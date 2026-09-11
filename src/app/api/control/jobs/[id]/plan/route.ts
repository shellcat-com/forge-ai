import {
  approveHostedPlan,
  hostedReviewError,
  readHostedPlan,
} from '../../../../../../server/control/reviews'
export const runtime = 'nodejs'
export const maxDuration = 30
type Context = { params: Promise<{ id: string }> }
export async function GET(request: Request, context: Context) {
  try {
    return Response.json(await readHostedPlan(request, (await context.params).id), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return hostedReviewError(error)
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const result = await approveHostedPlan(request, (await context.params).id)
    return Response.json(result.body, {
      status: result.status,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return hostedReviewError(error)
  }
}
