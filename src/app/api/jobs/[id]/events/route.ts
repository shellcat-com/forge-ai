import "server-only";
import { z } from "zod";
import { and, asc, eq, gt } from "drizzle-orm";
import { setTimeout as delay } from "node:timers/promises";
import { db } from "../../../../../server/db";
import { jobs, events } from "../../../../../server/db/schema";
import { assertLocalRequest } from "../../../../../server/http/local";
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
  const id = z.uuid().safeParse((await context.params).id);
  if (!id.success) return new Response("Invalid job", { status: 400 });
  let after = Math.max(
    Number(request.headers.get("last-event-id") ?? 0),
    Number(new URL(request.url).searchParams.get("after") ?? 0),
  );
  if (!Number.isSafeInteger(after) || after < 0 || after > 2147483647)
    return new Response("Invalid cursor", { status: 400 });
  try {
    if (!(await db().query.jobs.findFirst({ where: eq(jobs.id, id.data) })))
      return new Response("Job not found", { status: 404 });
  } catch {
    return new Response("Database unavailable", { status: 503 });
  }
  let cancelled = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (text: string) => {
        if (!cancelled && !request.signal.aborted)
          controller.enqueue(encoder.encode(text));
      };
      try {
        while (!cancelled && !request.signal.aborted) {
          const job = await db().query.jobs.findFirst({
            where: eq(jobs.id, id.data),
          });
          const rows = await db()
            .select()
            .from(events)
            .where(and(eq(events.jobId, id.data), gt(events.id, after)))
            .orderBy(asc(events.id))
            .limit(100);
          for (const event of rows) {
            send(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
            after = event.id;
          }
          if (
            rows.length < 100 &&
            job &&
            ["complete", "failed"].includes(job.status)
          ) {
            send(
              `event: end\ndata: ${JSON.stringify({ status: job.status })}\n\n`,
            );
            break;
          }
          send(": heartbeat\n\n");
          await delay(1000, undefined, { signal: request.signal });
        }
      } catch {
        if (!request.signal.aborted)
          send(
            'event: interrupted\ndata: {"message":"Connection interrupted; reconnect to replay events."}\n\n',
          );
      } finally {
        if (!cancelled && !request.signal.aborted) controller.close();
      }
    },
    cancel() {
      cancelled = true;
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
