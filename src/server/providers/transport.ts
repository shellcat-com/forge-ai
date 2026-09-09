import { setTimeout as delay } from "node:timers/promises";
import { ProviderError } from "./errors";
export async function request(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  retries = 2,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal, redirect: "error" });
    } catch {
      signal.throwIfAborted();
      if (attempt >= retries) throw new ProviderError("unavailable");
      await delay(300 * 2 ** attempt, undefined, { signal });
      continue;
    }
    if (response.ok) return response;
    await response.body?.cancel();
    if (response.status === 401 || response.status === 403)
      throw new ProviderError("authentication");
    if (response.status === 402) throw new ProviderError("quota");
    if (response.status === 429 || response.status >= 500) {
      if (attempt < retries) {
        const retryAfter = response.headers.get("retry-after");
        const wait = retryAfter
          ? Number(retryAfter) * 1000 || Date.parse(retryAfter) - Date.now()
          : 300 * 2 ** attempt;
        if (wait > 5000)
          throw new ProviderError(
            response.status === 429 ? "quota" : "unavailable",
          );
        await delay(
          Math.max(100, Math.min(5000, wait || 300)) + Math.random() * 100,
          undefined,
          { signal },
        );
        continue;
      }
      throw new ProviderError(
        response.status === 429 ? "quota" : "unavailable",
      );
    }
    throw new ProviderError("configuration");
  }
}
export async function* lines(response: Response): AsyncGenerator<string> {
  if (!response.body) throw new ProviderError("malformed");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        if (buffer.trim()) yield buffer.replace(/\r$/, "");
        break;
      }
      bytes += value.byteLength;
      if (bytes > 2_000_000) throw new ProviderError("limit");
      buffer += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        yield buffer.slice(0, index).replace(/\r$/, "");
        buffer = buffer.slice(index + 1);
      }
      if (buffer.length > 262_144) throw new ProviderError("limit");
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function* jsonFrames(
  response: Response,
  format: "sse" | "ndjson",
): AsyncGenerator<unknown> {
  let data: string[] = [];
  function parse(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      throw new ProviderError("malformed");
    }
  }
  for await (const line of lines(response)) {
    if (format === "ndjson") {
      if (line.trim()) yield parse(line);
      continue;
    }
    if (line === "") {
      if (data.length) {
        const text = data.join("\n");
        data = [];
        if (text !== "[DONE]") yield parse(text);
      }
    } else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length) {
    const text = data.join("\n");
    if (text !== "[DONE]") yield parse(text);
  }
}
export async function boundedJson(
  response: Response,
  maxBytes = 2_000_000,
): Promise<unknown> {
  if (!response.body) throw new ProviderError("malformed");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        text += decoder.decode();
        break;
      }
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new ProviderError("limit");
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError("malformed");
  }
}
export function boundedRequest(maxTokens: number, prompt: string): void {
  if (
    !Number.isInteger(maxTokens) ||
    maxTokens < 1 ||
    maxTokens > 8192 ||
    prompt.length > 100_000
  )
    throw new ProviderError("limit");
}
