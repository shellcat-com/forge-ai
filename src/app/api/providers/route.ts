import "server-only";
import { providerStatuses } from "../../../server/providers/registry";
import { assertLocalRequest } from "../../../server/http/local";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
  } catch {
    return Response.json({ error: "Forbidden origin" }, { status: 403 });
  }
  return Response.json(await providerStatuses(request.signal), {
    headers: { "Cache-Control": "no-store" },
  });
}
