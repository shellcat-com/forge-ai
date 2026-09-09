import { z } from "zod";
import type {
  ProviderAdapter,
  GenerationRequest,
  ModelDescriptor,
  ProviderEvent,
} from "../../shared/providers";
import { ProviderError } from "./errors";
import { boundedRequest, jsonFrames, request } from "./transport";
const catalog = z.object({
  models: z
    .array(
      z.object({
        name: z.string(),
        displayName: z.string().optional(),
        supportedGenerationMethods: z.array(z.string()).optional(),
        outputTokenLimit: z.number().optional(),
      }),
    )
    .optional(),
  nextPageToken: z.string().optional(),
});
const chunk = z.object({
  error: z.unknown().optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z
              .array(
                z.object({
                  text: z.string().optional(),
                  thought: z.boolean().optional(),
                }),
              )
              .optional(),
          })
          .optional(),
        finishReason: z.string().optional(),
      }),
    )
    .optional(),
  usageMetadata: z
    .object({ candidatesTokenCount: z.number().optional() })
    .optional(),
});
export class GeminiAdapter implements ProviderAdapter {
  readonly id = "gemini" as const;
  constructor(
    private readonly key: string,
    private readonly allowedModel: string,
    private readonly freeTierConfirmed: boolean,
  ) {}
  async listModels(signal: AbortSignal): Promise<ModelDescriptor[]> {
    if (!this.key) throw new ProviderError("configuration");
    const models: ModelDescriptor[] = [];
    let page = "";
    for (let i = 0; i < 5; i++) {
      const response = await request(
        `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`,
        { headers: { "x-goog-api-key": this.key } },
        AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      );
      const parsed = catalog.safeParse(await response.json());
      if (!parsed.success) throw new ProviderError("malformed");
      for (const m of parsed.data.models ?? [])
        if (m.supportedGenerationMethods?.includes("generateContent"))
          models.push({
            id: m.name.replace(/^models\//, ""),
            name: m.displayName ?? m.name,
            outputTokenLimit: m.outputTokenLimit,
          });
      page = parsed.data.nextPageToken ?? "";
      if (!page) return models;
    }
    throw new ProviderError("limit");
  }
  async *generate(
    input: GenerationRequest,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    boundedRequest(input.maxTokens, input.prompt);
    if (
      !this.key ||
      !this.freeTierConfirmed ||
      input.model !== this.allowedModel ||
      !/^[\w.-]+$/.test(input.model)
    )
      throw new ProviderError("configuration");
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
    const models = await this.listModels(bounded);
    const model = models.find((m) => m.id === input.model);
    if (!model) throw new ProviderError("configuration");
    const response = await request(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.key,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: input.prompt }] }],
          systemInstruction: input.system
            ? { parts: [{ text: input.system }] }
            : undefined,
          generationConfig: {
            maxOutputTokens: Math.min(
              input.maxTokens,
              model.outputTokenLimit ?? input.maxTokens,
            ),
            temperature: 0.2,
            responseMimeType: input.json ? "application/json" : "text/plain",
          },
        }),
      },
      bounded,
    );
    let completed = false;
    let outputTokens: number | undefined;
    for await (const raw of jsonFrames(response, "sse")) {
      const parsed = chunk.safeParse(raw);
      if (
        !parsed.success ||
        parsed.data.error ||
        parsed.data.promptFeedback?.blockReason
      )
        throw new ProviderError("malformed");
      const data = parsed.data;
      outputTokens = data.usageMetadata?.candidatesTokenCount ?? outputTokens;
      for (const candidate of data.candidates ?? []) {
        for (const part of candidate.content?.parts ?? [])
          if (part.text && !part.thought)
            yield { type: "delta", text: part.text };
        if (candidate.finishReason) {
          if (candidate.finishReason !== "STOP")
            throw new ProviderError(
              candidate.finishReason === "MAX_TOKENS" ? "limit" : "malformed",
            );
          completed = true;
        }
      }
    }
    if (!completed) throw new ProviderError("malformed");
    yield { type: "done", outputTokens };
  }
}
