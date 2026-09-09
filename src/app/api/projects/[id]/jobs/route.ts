import "server-only";
import { z } from "zod";
import {
  assertLocalRequest,
  smallJson,
} from "../../../../../server/http/local";
import { queueJob, readiness } from "../../../../../server/projects/service";
const input = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("generate"),
      prompt: z.string().trim().min(5).max(12000),
      provider: z.enum(["gemini", "ollama"]),
      model: z.string().min(1).max(200),
    })
    .strict(),
  z
    .object({
      kind: z.literal("edit"),
      files: z.record(z.string(), z.string()),
    })
    .strict(),
  z.object({ kind: z.literal("restore"), revisionId: z.uuid() }).strict(),
]);
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertLocalRequest(request, true);
  } catch {
    return Response.json({ error: "Forbidden origin" }, { status: 403 });
  }
  let parsed: z.infer<typeof input>;
  const id = z.uuid().safeParse((await context.params).id);
  try {
    parsed = input.parse(await smallJson(request, 350000));
    if (!id.success) throw new Error();
  } catch {
    return Response.json(
      { error: "Invalid revision request." },
      { status: 400 },
    );
  }
  try {
    if (!(await readiness()).worker)
      return Response.json(
        { error: "Start the Forge worker first." },
        { status: 503 },
      );
    return Response.json(await queueJob(id.data!, parsed), { status: 202 });
  } catch {
    return Response.json(
      {
        error:
          "Could not queue this change. Check the files and revision, or wait for the current job to finish.",
      },
      { status: 409 },
    );
  }
}
