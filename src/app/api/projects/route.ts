import "server-only";
import { z } from "zod";
import { desc } from "drizzle-orm";
import { db } from "../../../server/db";
import { projects } from "../../../server/db/schema";
import { assertLocalRequest, smallJson } from "../../../server/http/local";
import { createProject, readiness } from "../../../server/projects/service";
const input = z
  .object({
    prompt: z.string().trim().min(20).max(12000),
    provider: z.enum(["gemini", "ollama"]),
    model: z.string().min(1).max(200),
  })
  .strict();
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
  } catch {
    return Response.json({ error: "Forbidden origin" }, { status: 403 });
  }
  try {
    return Response.json(
      await db()
        .select()
        .from(projects)
        .orderBy(desc(projects.createdAt))
        .limit(50),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Project database unavailable." },
      { status: 503 },
    );
  }
}
export async function POST(request: Request) {
  try {
    assertLocalRequest(request, true);
  } catch {
    return Response.json({ error: "Forbidden origin" }, { status: 403 });
  }
  let parsed: z.infer<typeof input>;
  try {
    parsed = input.parse(await smallJson(request, 50000));
  } catch {
    return Response.json(
      {
        error:
          "Provide a prompt of 20–12,000 characters and an available model.",
      },
      { status: 400 },
    );
  }
  try {
    if (!(await readiness()).worker)
      return Response.json(
        { error: "Start the Forge worker first." },
        { status: 503 },
      );
    return Response.json(await createProject(parsed), { status: 201 });
  } catch {
    return Response.json(
      { error: "Could not create the project. Check local PostgreSQL." },
      { status: 503 },
    );
  }
}
