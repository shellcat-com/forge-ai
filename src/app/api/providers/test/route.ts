import "server-only";
import { z } from "zod";
import { provider } from "../../../../server/providers/registry";
import { safeProviderError } from "../../../../server/providers/errors";
import { assertLocalRequest, smallJson } from "../../../../server/http/local";
const input = z
  .object({
    provider: z.enum(["gemini", "ollama"]),
    model: z.string().min(1).max(200),
  })
  .strict();
let busy = false;
export async function POST(request: Request) {
  try {
    assertLocalRequest(request, true);
  } catch {
    return Response.json({ error: "Forbidden origin" }, { status: 403 });
  }
  let parsed: z.infer<typeof input>;
  try {
    parsed = input.parse(await smallJson(request, 1000));
  } catch {
    return Response.json(
      { error: "Invalid provider selection" },
      { status: 400 },
    );
  }
  if (busy)
    return Response.json(
      { error: "A provider test is already running." },
      { status: 409 },
    );
  busy = true;
  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, controller.signal]);
  const stream = new ReadableStream({
    async start(sink) {
      const encoder = new TextEncoder();
      const send = (event: unknown) => {
        if (!signal.aborted)
          sink.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      try {
        for await (const event of provider(parsed.provider).generate(
          {
            model: parsed.model,
            prompt: "Reply with exactly: Forge is ready.",
            maxTokens: 32,
          },
          signal,
        ))
          send(event);
      } catch (e) {
        const error = safeProviderError(e);
        send({ type: "error", code: error.code, message: error.message });
      } finally {
        busy = false;
        if (!signal.aborted) sink.close();
      }
    },
    cancel() {
      controller.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
