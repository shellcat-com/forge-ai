import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonFrames, request } from "../../src/server/providers/transport";
import {
  localOllamaUrl,
  OllamaAdapter,
} from "../../src/server/providers/ollama";
import { GeminiAdapter } from "../../src/server/providers/gemini";
import { OpenRouterAdapter } from "../../src/server/providers/openrouter";
import { safeProviderError } from "../../src/server/providers/errors";
import { assertLocalRequest, smallJson } from "../../src/server/http/local";
const signal = () => new AbortController().signal;
function response(chunks: string[]) {
  return new Response(
    new ReadableStream({
      start(s) {
        for (const c of chunks) s.enqueue(new TextEncoder().encode(c));
        s.close();
      },
    }),
  );
}
async function collect<T>(stream: AsyncIterable<T>) {
  const values: T[] = [];
  for await (const v of stream) values.push(v);
  return values;
}
afterEach(() => vi.unstubAllGlobals());
describe("bounded streams", () => {
  it("handles split SSE frames, comments and CRLF", async () => {
    expect(
      await collect(
        jsonFrames(
          response([': hello\r\ndata: {"v":', '1}\r\n\r\ndata: {"v":2}\n\n']),
          "sse",
        ),
      ),
    ).toEqual([{ v: 1 }, { v: 2 }]);
  });
  it("handles split NDJSON and last frame without newline", async () => {
    expect(
      await collect(jsonFrames(response(['{"v":', '1}\n{"v":2}']), "ndjson")),
    ).toEqual([{ v: 1 }, { v: 2 }]);
  });
  it("rejects malformed and oversized frames", async () => {
    await expect(
      collect(jsonFrames(response(["data: invalid\n\n"]), "sse")),
    ).rejects.toMatchObject({ code: "malformed" });
    await expect(
      collect(jsonFrames(response(["x".repeat(300000)]), "ndjson")),
    ).rejects.toMatchObject({ code: "limit" });
  });
  it("does not expose a provider response body on auth error", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("SECRET-SENTINEL", { status: 401 })),
    );
    await expect(
      request("https://example.com", {}, signal()),
    ).rejects.toMatchObject({ code: "authentication" });
  });
  it("reports quota instead of waiting beyond budget", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response("", { status: 429, headers: { "retry-after": "60" } }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      request("https://example.com", {}, signal()),
    ).rejects.toMatchObject({ code: "quota" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("retries transient server failures before a stream starts", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok"));
    vi.stubGlobal("fetch", fetch);
    expect((await request("https://example.com", {}, signal())).status).toBe(
      200,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("honors cancellation before sending", async () => {
    const c = new AbortController();
    c.abort();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      request("https://example.com", {}, c.signal),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("sanitizes unknown errors and classifies timeout", () => {
    expect(
      safeProviderError(new Error("SECRET-SENTINEL")).message,
    ).not.toContain("SECRET");
    expect(
      safeProviderError(new DOMException("secret", "TimeoutError")).code,
    ).toBe("timeout");
  });
});
describe("provider contracts", () => {
  it("only accepts explicit loopback Ollama endpoints", () => {
    expect(localOllamaUrl("http://127.0.0.1:11434")).toBe(
      "http://127.0.0.1:11434",
    );
    for (const url of [
      "http://evil.test",
      "http://127.0.0.1:11434/path",
      "http://user:secret@127.0.0.1",
      "http://host.docker.internal",
      "http://127.0.0.1/?x=1",
    ])
      expect(() => localOllamaUrl(url)).toThrow();
  });
  it("streams Ollama output and requires completion", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ models: [{ name: "test-local", size: 100 }] }),
        )
        .mockResolvedValueOnce(
          response([
            '{"response":"hello","done":false}\n',
            '{"done":true,"eval_count":1}\n',
          ]),
        ),
    );
    expect(
      await collect(
        new OllamaAdapter().generate(
          { model: "test-local", prompt: "test", maxTokens: 32 },
          signal(),
        ),
      ),
    ).toEqual([
      { type: "delta", text: "hello" },
      { type: "done", outputTokens: 1 },
    ]);
  });
  it("rejects truncated Ollama responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ models: [{ name: "test" }] }))
        .mockResolvedValueOnce(response(['{"response":"partial"}\n'])),
    );
    await expect(
      collect(
        new OllamaAdapter().generate(
          { model: "test", prompt: "x", maxTokens: 8 },
          signal(),
        ),
      ),
    ).rejects.toMatchObject({ code: "malformed" });
  });
  it("requires Gemini free-tier confirmation before a request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      collect(
        new GeminiAdapter("sentinel", "test", false).generate(
          { model: "test", prompt: "x", maxTokens: 8 },
          signal(),
        ),
      ),
    ).rejects.toMatchObject({ code: "configuration" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("filters Gemini thought parts and uses header authentication", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          models: [
            {
              name: "models/test",
              supportedGenerationMethods: ["generateContent"],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response([
          'data: {"candidates":[{"content":{"parts":[{"text":"hidden","thought":true},{"text":"visible"}]},"finishReason":"STOP"}]}\n\n',
        ]),
      );
    vi.stubGlobal("fetch", fetch);
    const events = await collect(
      new GeminiAdapter("SENTINEL", "test", true).generate(
        { model: "test", prompt: "x", maxTokens: 8 },
        signal(),
      ),
    );
    expect(events).toEqual([
      { type: "delta", text: "visible" },
      { type: "done", outputTokens: undefined },
    ]);
    expect(fetch.mock.calls.every((c) => !c[0].includes("SENTINEL"))).toBe(
      true,
    );
  });
  it("discovers only the configured OpenRouter model", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        data: [
          {
            id: "other/model",
            name: "Other",
            top_provider: { max_completion_tokens: null },
          },
          { id: null, name: null },
          {
            id: "openai/gpt-4o",
            name: "GPT-4o",
            supported_parameters: ["structured_outputs"],
            top_provider: { max_completion_tokens: 4096 },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(
      new OpenRouterAdapter("SENTINEL", "openai/gpt-4o", true).listModels(
        signal(),
      ),
    ).resolves.toEqual([
      {
        id: "openai/gpt-4o",
        name: "GPT-4o",
        outputTokenLimit: 4096,
        supportsStructuredOutputs: true,
      },
    ]);
    expect(fetch.mock.calls[0][0]).not.toContain("SENTINEL");
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer SENTINEL",
    );
  });
  it("streams structured OpenRouter output with bounded paid model selection", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          data: [
            {
              id: "openai/gpt-4o",
              name: "GPT-4o",
              supported_parameters: ["response_format"],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response([
          ': OPENROUTER PROCESSING\n\ndata: {"choices":[{"delta":{"content":"{\\"ok\\":"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"true}"},"finish_reason":"stop"}],"usage":{"completion_tokens":3}}\n\ndata: [DONE]\n\n',
        ]),
      );
    vi.stubGlobal("fetch", fetch);
    const events = await collect(
      new OpenRouterAdapter("SENTINEL", "openai/gpt-4o", true).generate(
        {
          model: "openai/gpt-4o",
          prompt: "x",
          maxTokens: 8,
          json: true,
          schema: {
            type: "object",
            properties: { ok: { type: "boolean" } },
            required: ["ok"],
            additionalProperties: false,
          },
        },
        signal(),
      ),
    );
    expect(events).toEqual([
      { type: "delta", text: '{"ok":' },
      { type: "delta", text: "true}" },
      { type: "done", outputTokens: 3 },
    ]);
    const body = JSON.parse(fetch.mock.calls[1][1].body);
    expect(body.model).toBe("openai/gpt-4o");
    expect(body.max_tokens).toBe(8);
    expect(body.provider).toEqual({ require_parameters: true });
    expect(body.response_format.json_schema.strict).toBe(true);
  });
  it("rejects unconfigured OpenRouter model IDs without a request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      collect(
        new OpenRouterAdapter("SENTINEL", "openai/gpt-4o", true).generate(
          { model: "other/paid-model", prompt: "x", maxTokens: 8 },
          signal(),
        ),
      ),
    ).rejects.toMatchObject({ code: "configuration" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("requires explicit paid-model confirmation before OpenRouter requests", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      collect(
        new OpenRouterAdapter("SENTINEL", "openai/gpt-4o", false).generate(
          { model: "openai/gpt-4o", prompt: "x", maxTokens: 8 },
          signal(),
        ),
      ),
    ).rejects.toMatchObject({ code: "configuration" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("turns streamed OpenRouter credit errors into quota errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            data: [
              {
                id: "openai/gpt-4o",
                name: "GPT-4o",
                supported_parameters: ["response_format"],
              },
            ],
          }),
        )
        .mockResolvedValueOnce(response(['data: {"error":{"code":402}}\n\n'])),
    );
    await expect(
      collect(
        new OpenRouterAdapter("SENTINEL", "openai/gpt-4o", true).generate(
          { model: "openai/gpt-4o", prompt: "x", maxTokens: 8 },
          signal(),
        ),
      ),
    ).rejects.toMatchObject({ code: "quota" });
  });
});
describe("local control API", () => {
  it("accepts a legitimate Host when Next normalizes the request URL", () => {
    expect(() =>
      assertLocalRequest(
        new Request("http://localhost:3000/api", {
          headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
        }),
        true,
      ),
    ).not.toThrow();
  });
  it("rejects foreign origin and DNS rebinding", () => {
    for (const headers of [
      { host: "127.0.0.1:3000", origin: "http://evil.test" },
      { host: "evil.test", origin: "http://127.0.0.1:3000" },
    ])
      expect(() =>
        assertLocalRequest(
          new Request("http://127.0.0.1:3000/api", { headers }),
          true,
        ),
      ).toThrow();
  });
  it("accepts same-origin mutation and rejects absent origin", () => {
    expect(() =>
      assertLocalRequest(
        new Request("http://127.0.0.1:3000/api", {
          headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
        }),
        true,
      ),
    ).not.toThrow();
    expect(() =>
      assertLocalRequest(
        new Request("http://127.0.0.1:3000/api", {
          headers: { host: "127.0.0.1:3000" },
        }),
        true,
      ),
    ).toThrow();
  });
  it("bounds request bodies even without content-length", async () => {
    await expect(
      smallJson(
        new Request("http://127.0.0.1", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify("x".repeat(100)),
        }),
        10,
      ),
    ).rejects.toThrow("Body too large");
  });
});
