import "server-only";
import { assertLocalRequest } from "../../../server/http/local";
import { readiness } from "../../../server/projects/service";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
  } catch {
    return Response.json({ error: "Forbidden origin" }, { status: 403 });
  }
  try {
    return Response.json(await readiness(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      {
        database: false,
        worker: false,
        message:
          "Run npm run setup:local and npm run db:migrate to prepare PostgreSQL.",
      },
      { status: 503 },
    );
  }
}
