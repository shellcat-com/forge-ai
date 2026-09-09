import { z } from "zod";
import type {
  GenerationRequest,
  ModelDescriptor,
  ProviderAdapter,
  ProviderEvent,
} from "../../shared/providers";
import { ProviderError } from "./errors";
import { boundedJson, boundedRequest, jsonFrames, request } from "./transport";

const catalog = z.object({
  data: z.array(z.unknown()).max(1000),
});

const catalogModel = z.object({
  id: z.string().max(200),
  active: z.boolean().optional(),
  max_completion_tokens: z.number().positive().nullish(),
});

const choice = z.object({
  delta: z.object({ content: z.string().nullable().optional() }).optional(),
  message: z.object({ content: z.string().nullable() }).optional(),
  finish_reason: z.string().nullable().optional(),
});

const completion = z.object({
  choices: z.array(choice).min(1).max(1),
  usage: z.object({ completion_tokens: z.number().optional() }).optional(),
});

const streamChunk = z.object({
  error: z.unknown().optional(),
  choices: z.array(choice).optional(),
  usage: z
    .object({ completion_tokens: z.number().optional() })
    .nullable()
    .optional(),
});

const strictModels = new Set(["openai/gpt-oss-20b", "openai/gpt-oss-120b"]);

export class GroqAdapter implements ProviderAdapter {
  readonly id = "groq" as const;

  constructor(
    private readonly key: string,
    private readonly allowedModel: string,
  ) {}

  private headers() {
    return {
      Authorization: `Bearer ${this.key}`,
      "Content-Type": "application/json",
    };
  }

  async listModels(signal: AbortSignal): Promise<ModelDescriptor[]> {
    if (!this.key || !this.allowedModel)
      throw new ProviderError("configuration");
    const response = await request(
      "https://api.groq.com/openai/v1/models",
      { headers: this.headers() },
      AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    );
    const parsedCatalog = catalog.safeParse(await response.json());
    if (!parsedCatalog.success) throw new ProviderError("malformed");
    const rawModel = parsedCatalog.data.data.find(
      (model) =>
        typeof model === "object" &&
        model !== null &&
        "id" in model &&
        model.id === this.allowedModel,
    );
    if (!rawModel) return [];
    const parsedModel = catalogModel.safeParse(rawModel);
    if (!parsedModel.success || parsedModel.data.active === false)
      throw new ProviderError("malformed");
    return [
      {
        id: parsedModel.data.id,
        name: parsedModel.data.id,
        outputTokenLimit: parsedModel.data.max_completion_tokens ?? undefined,
        supportsStructuredOutputs: strictModels.has(parsedModel.data.id),
      },
    ];
  }

  async *generate(
    input: GenerationRequest,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    boundedRequest(input.maxTokens, input.prompt);
    if (
      !this.key ||
      !this.allowedModel ||
      input.model !== this.allowedModel ||
      !/^[a-zA-Z0-9_.~:-]+\/[a-zA-Z0-9_.~:-]+$/.test(input.model)
    )
      throw new ProviderError("configuration");
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
    const model = (await this.listModels(bounded))[0];
    if (!model || (input.schema && !model.supportsStructuredOutputs))
      throw new ProviderError("configuration");
    const useStrictOutput = Boolean(input.schema);
    const response = await request(
      "https://api.groq.com/openai/v1/chat/completions",
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
          stream: !useStrictOutput,
          stream_options: useStrictOutput ? undefined : { include_usage: true },
          reasoning_effort: "low",
          include_reasoning: false,
          temperature: 0.2,
          max_completion_tokens: Math.min(
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
        }),
      },
      bounded,
    );

    if (useStrictOutput) {
      const parsed = completion.safeParse(await boundedJson(response, 300_000));
      if (!parsed.success) throw new ProviderError("malformed");
      const result = parsed.data.choices[0];
      if (result.finish_reason !== "stop")
        throw new ProviderError(
          result.finish_reason === "length" ? "limit" : "malformed",
        );
      if (!result.message?.content) throw new ProviderError("malformed");
      yield { type: "delta", text: result.message.content };
      yield {
        type: "done",
        outputTokens: parsed.data.usage?.completion_tokens,
      };
      return;
    }

    let completed = false;
    let outputTokens: number | undefined;
    for await (const raw of jsonFrames(response, "sse")) {
      const parsed = streamChunk.safeParse(raw);
      if (!parsed.success || parsed.data.error)
        throw new ProviderError("malformed");
      outputTokens = parsed.data.usage?.completion_tokens ?? outputTokens;
      for (const result of parsed.data.choices ?? []) {
        if (result.delta?.content)
          yield { type: "delta", text: result.delta.content };
        if (result.finish_reason) {
          if (result.finish_reason !== "stop")
            throw new ProviderError(
              result.finish_reason === "length" ? "limit" : "malformed",
            );
          completed = true;
        }
      }
    }
    if (!completed) throw new ProviderError("malformed");
    yield { type: "done", outputTokens };
  }
}
