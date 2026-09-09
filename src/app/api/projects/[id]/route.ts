import "server-only";
import { z } from "zod";
import { assertLocalRequest } from "../../../../server/http/local";
import { projectDetail } from "../../../../server/projects/service";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertLocalRequest(request);
  } catch {
    return Response.json({ error: "Forbidden origin" }, { status: 403 });
  }
  const parsed = z.uuid().safeParse((await context.params).id);
  if (!parsed.success)
    return Response.json({ error: "Invalid project" }, { status: 400 });
  try {
    const detail = await projectDetail(parsed.data);
    return Response.json(detail ?? { error: "Project not found" }, {
      status: detail ? 200 : 404,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "Project could not be loaded." },
      { status: 503 },
    );
  }
}
