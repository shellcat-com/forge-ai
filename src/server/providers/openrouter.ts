import { z } from "zod";
import type {
  GenerationRequest,
  ModelDescriptor,
  ProviderAdapter,
  ProviderEvent,
} from "../../shared/providers";
import { ProviderError } from "./errors";
import { boundedRequest, jsonFrames, request } from "./transport";

const catalog = z.object({
  data: z
    .array(
      z.object({
        id: z.string().max(200),
        name: z.string().max(300),
        supported_parameters: z.array(z.string()).optional(),
        top_provider: z
          .object({ max_completion_tokens: z.number().positive().optional() })
          .optional(),
      }),
    )
    .max(2000),
});

const chunk = z.object({
  error: z.object({ code: z.number().optional() }).passthrough().optional(),
  choices: z
    .array(
      z.object({
        delta: z
          .object({ content: z.string().nullable().optional() })
          .optional(),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .optional(),
  usage: z.object({ completion_tokens: z.number().optional() }).optional(),
});

export class OpenRouterAdapter implements ProviderAdapter {
  readonly id = "openrouter" as const;

  constructor(
    private readonly key: string,
    private readonly allowedModel: string,
    private readonly paidUseConfirmed: boolean,
  ) {}

  private headers() {
    return {
      Authorization: `Bearer ${this.key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://127.0.0.1:3000",
      "X-OpenRouter-Title": "Forge AI",
    };
  }

  async listModels(signal: AbortSignal): Promise<ModelDescriptor[]> {
    if (!this.key || !this.allowedModel || !this.paidUseConfirmed)
      throw new ProviderError("configuration");
    const response = await request(
      "https://openrouter.ai/api/v1/models?output_modalities=text",
      { headers: this.headers() },
      AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    );
    const parsed = catalog.safeParse(await response.json());
    if (!parsed.success) throw new ProviderError("malformed");
    return parsed.data.data
      .filter((model) => model.id === this.allowedModel)
      .map((model) => ({
        id: model.id,
        name: model.name,
        outputTokenLimit: model.top_provider?.max_completion_tokens,
        supportsStructuredOutputs:
          model.supported_parameters?.includes("structured_outputs") ||
          model.supported_parameters?.includes("response_format"),
      }));
  }

  async *generate(
    input: GenerationRequest,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    boundedRequest(input.maxTokens, input.prompt);
    if (
      !this.key ||
      !this.allowedModel ||
      !this.paidUseConfirmed ||
      input.model !== this.allowedModel ||
      !/^[a-zA-Z0-9_.~:-]+\/[a-zA-Z0-9_.~:-]+$/.test(input.model)
    )
      throw new ProviderError("configuration");
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
    const model = (await this.listModels(bounded))[0];
    if (!model || (input.schema && !model.supportsStructuredOutputs))
      throw new ProviderError("configuration");
    const response = await request(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model: input.model,
          messages: [
            ...(input.system
              ? [{ role: "system" as const, content: input.system }]
              : []),
            { role: "user", content: input.prompt },
          ],
          stream: true,
          temperature: 0.2,
          max_tokens: Math.min(
            input.maxTokens,
            model.outputTokenLimit ?? input.maxTokens,
          ),
          response_format: input.schema
            ? {
                type: "json_schema",
                json_schema: {
                  name: "forge_file_operations",
                  strict: true,
                  schema: input.schema,
                },
              }
            : input.json
              ? { type: "json_object" }
              : undefined,
          provider: input.schema ? { require_parameters: true } : undefined,
        }),
      },
      bounded,
    );
    let completed = false;
    let outputTokens: number | undefined;
    for await (const raw of jsonFrames(response, "sse")) {
      const parsed = chunk.safeParse(raw);
      if (!parsed.success) throw new ProviderError("malformed");
      if (parsed.data.error) {
        const code = parsed.data.error.code;
        throw new ProviderError(
          code === 401 || code === 403
            ? "authentication"
            : code === 402 || code === 429
              ? "quota"
              : code && code >= 500
                ? "unavailable"
                : "malformed",
        );
      }
      outputTokens = parsed.data.usage?.completion_tokens ?? outputTokens;
      for (const choice of parsed.data.choices ?? []) {
        if (choice.delta?.content)
          yield { type: "delta", text: choice.delta.content };
        if (choice.finish_reason) {
          if (choice.finish_reason !== "stop")
            throw new ProviderError(
              choice.finish_reason === "length" ? "limit" : "malformed",
            );
          completed = true;
        }
      }
    }
    if (!completed) throw new ProviderError("malformed");
    yield { type: "done", outputTokens };
  }
}
