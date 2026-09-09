import { OllamaAdapter } from "../src/server/providers/ollama";
import { safeProviderError } from "../src/server/providers/errors";
const adapter = new OllamaAdapter();
try {
  const models = await adapter.listModels(AbortSignal.timeout(5000));
  if (!models.length) throw new Error("No installed model");
  let deltas = 0;
  let completed = false;
  let outputTokens = 0;
  for await (const event of adapter.generate(
    {
      model: models[0].id,
      prompt: "Reply with exactly: Forge is ready.",
      maxTokens: 32,
    },
    AbortSignal.timeout(180000),
  )) {
    if (event.type === "delta") deltas++;
    else {
      completed = true;
      outputTokens = event.outputTokens ?? 0;
    }
  }
  console.log(
    JSON.stringify({
      provider: "ollama",
      model: models[0].id,
      deltas,
      completed,
      outputTokens,
    }),
  );
  if (!completed || !deltas) process.exitCode = 1;
} catch (e) {
  console.log(
    JSON.stringify({ provider: "ollama", error: safeProviderError(e).code }),
  );
  process.exitCode = 1;
}
