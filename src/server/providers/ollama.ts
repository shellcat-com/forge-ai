import { z } from "zod";
import type {
  ProviderAdapter,
  GenerationRequest,
  ModelDescriptor,
  ProviderEvent,
} from "../../shared/providers";
import { ProviderError } from "./errors";
import { request, jsonFrames, boundedRequest } from "./transport";
const modelList = z.object({
  models: z
    .array(z.object({ name: z.string().max(200), size: z.number().optional() }))
    .max(200),
});
const frame = z.object({
  response: z.string().optional(),
  done: z.boolean().optional(),
  eval_count: z.number().optional(),
  error: z.string().optional(),
  done_reason: z.string().optional(),
});
export function localOllamaUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderError("configuration");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new ProviderError("configuration");
  return url.origin;
}
export class OllamaAdapter implements ProviderAdapter {
  readonly id = "ollama" as const;
  readonly baseUrl: string;
  constructor(baseUrl = "http://127.0.0.1:11434") {
    this.baseUrl = localOllamaUrl(baseUrl);
  }
  async listModels(signal: AbortSignal): Promise<ModelDescriptor[]> {
    const response = await request(
      `${this.baseUrl}/api/tags`,
      {},
      AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      0,
    );
    const parsed = modelList.safeParse(await response.json());
    if (!parsed.success) throw new ProviderError("malformed");
    return parsed.data.models
      .sort((a, b) => (a.size ?? Infinity) - (b.size ?? Infinity))
      .map((m) => ({ id: m.name, name: m.name, sizeBytes: m.size }));
  }
  async *generate(
    input: GenerationRequest,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    boundedRequest(input.maxTokens, input.prompt);
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(180_000)]);
    const models = await this.listModels(bounded);
    if (!models.some((m) => m.id === input.model))
      throw new ProviderError("configuration");
    const response = await request(
      `${this.baseUrl}/api/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: input.model,
          prompt: input.prompt,
          system: input.system,
          stream: true,
          keep_alive: 0,
          format: input.schema ?? (input.json ? "json" : undefined),
          options: {
            num_predict: input.maxTokens,
            num_ctx: 8192,
            temperature: 0.2,
          },
        }),
      },
      bounded,
      0,
    );
    for await (const raw of jsonFrames(response, "ndjson")) {
      const parsed = frame.safeParse(raw);
      if (!parsed.success || parsed.data.error)
        throw new ProviderError("malformed");
      const data = parsed.data;
      if (data.response) yield { type: "delta", text: data.response };
      if (data.done) {
        if (data.done_reason === "length") throw new ProviderError("limit");
        yield { type: "done", outputTokens: data.eval_count };
        return;
      }
    }
    throw new ProviderError("malformed");
  }
}
