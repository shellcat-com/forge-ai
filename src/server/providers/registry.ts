import type { ProviderAdapter, ProviderStatus } from "../../shared/providers";
import { GeminiAdapter } from "./gemini";
import { OllamaAdapter } from "./ollama";
import { ProviderError, safeProviderError } from "./errors";
export function provider(id: string): ProviderAdapter {
  if (id === "ollama") return new OllamaAdapter(process.env.OLLAMA_BASE_URL);
  if (id === "gemini")
    return new GeminiAdapter(
      process.env.GEMINI_API_KEY ?? "",
      process.env.GEMINI_MODEL ?? "",
      process.env.GEMINI_FREE_TIER_CONFIRMED === "true",
    );
  throw new ProviderError("configuration");
}
export async function providerStatuses(
  signal: AbortSignal,
): Promise<ProviderStatus[]> {
  return Promise.all(
    (["gemini", "ollama"] as const).map(async (id) => {
      const base = {
        id,
        name: id === "gemini" ? "Google Gemini" : "Local Ollama",
      };
      if (id === "gemini" && !process.env.GEMINI_API_KEY)
        return {
          ...base,
          available: false,
          models: [],
          message:
            "Enter GEMINI_API_KEY privately in .env.local, then restart Forge.",
        };
      try {
        const models = await provider(id).listModels(signal);
        const selectedModel =
          id === "gemini" ? process.env.GEMINI_MODEL : models[0]?.id;
        const available =
          models.some((m) => m.id === selectedModel) &&
          (id !== "gemini" ||
            process.env.GEMINI_FREE_TIER_CONFIRMED === "true");
        return {
          ...base,
          models,
          selectedModel,
          available,
          message: available
            ? "Model discovery succeeded. Test streaming to verify generation."
            : id === "gemini"
              ? "Select GEMINI_MODEL and confirm its free-tier eligibility in server configuration."
              : "No installed models found. Forge will not download one automatically.",
        };
      } catch (e) {
        return {
          ...base,
          available: false,
          models: [],
          message: safeProviderError(e).message,
        };
      }
    }),
  );
}
