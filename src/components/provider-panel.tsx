"use client";
import { useEffect, useState, useRef } from "react";
import type { ProviderStatus } from "../shared/providers";
export function ProviderPanel() {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string>();
  const [result, setResult] = useState<Record<string, string>>({});
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/providers", { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        return r.json() as Promise<ProviderStatus[]>;
      })
      .then((data) => {
        setProviders(data);
        setSelection(
          Object.fromEntries(data.map((p) => [p.id, p.selectedModel ?? ""])),
        );
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            "Could not discover providers. Retry after checking the server.",
          );
      })
      .finally(() => setLoading(false));
    return () => {
      controller.abort();
      abort.current?.abort();
    };
  }, []);
  async function test(p: ProviderStatus) {
    const controller = new AbortController();
    abort.current = controller;
    setTesting(p.id);
    setResult((r) => ({ ...r, [p.id]: "Connecting…" }));
    try {
      const response = await fetch("/api/providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: p.id, model: selection[p.id] }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body)
        throw new Error("The provider test could not start.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      let doneEvent = false;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let index: number;
          while ((index = buffer.indexOf("\n")) >= 0) {
            const event = JSON.parse(buffer.slice(0, index));
            buffer = buffer.slice(index + 1);
            if (event.type === "error") throw new Error(event.message);
            if (event.type === "delta") {
              text = (text + event.text).slice(0, 1000);
              setResult((r) => ({ ...r, [p.id]: `Streaming: ${text}` }));
            }
            if (event.type === "done") {
              doneEvent = true;
              setResult((r) => ({
                ...r,
                [p.id]: `Streaming verified: ${text || "completed"}`,
              }));
            }
          }
        }
        if (!doneEvent) throw new Error("The stream ended before completion.");
      } finally {
        await reader.cancel().catch(() => {});
      }
    } catch (e) {
      setResult((r) => ({
        ...r,
        [p.id]: controller.signal.aborted
          ? "Test cancelled."
          : e instanceof Error
            ? e.message
            : "Provider test failed.",
      }));
    } finally {
      setTesting(undefined);
    }
  }
  return (
    <>
      {loading && (
        <p role="status" className="provider-intro">
          Discovering available models…
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="provider-cards">
        {providers.map((p) => (
          <article key={p.id} className="provider-card">
            <span className="starter-icon">
              {p.id === "gemini" ? "✳" : p.id === "openrouter" ? "↗" : "◎"}
            </span>
            <h2>{p.name}</h2>
            <span className="provider-badge">
              {result[p.id]?.startsWith("Streaming verified:")
                ? "Streaming verified"
                : p.available
                  ? "Available · not yet tested"
                  : "Setup required"}
            </span>
            <p>{p.message}</p>
            {p.models.length > 0 && (
              <label className="model-label">
                Model
                <select
                  aria-label={`${p.name} model`}
                  value={selection[p.id] || ""}
                  onChange={(e) =>
                    setSelection((s) => ({ ...s, [p.id]: e.target.value }))
                  }
                >
                  <option value="" disabled>
                    Select a model
                  </option>
                  {p.models.map((m) => (
                    <option
                      key={m.id}
                      value={m.id}
                      disabled={p.id === "gemini" && m.id !== p.selectedModel}
                    >
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              className="provider-test"
              disabled={!p.available || !!testing || !selection[p.id]}
              onClick={() => test(p)}
            >
              Test streaming
            </button>
            {testing === p.id && (
              <button
                className="text-button cancel-test"
                onClick={() => abort.current?.abort()}
              >
                Cancel test
              </button>
            )}
            <p className="test-result" role="status">
              {result[p.id] ?? ""}
            </p>
          </article>
        ))}
      </div>
      <p className="provider-intro">
        Gemini requires a free-tier project and a model verified against current
        pricing. No billing is enabled by Forge. Google’s free-tier data-use
        terms apply. OpenRouter may use paid credits depending on the selected
        model; Forge never enables billing. Groq remains deferred.
      </p>
    </>
  );
}
