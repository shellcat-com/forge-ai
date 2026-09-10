import type { ProviderAdapter, ProviderStatus } from "../../shared/providers";
import { GeminiAdapter } from "./gemini";
import { GroqAdapter } from "./groq";
import { OllamaAdapter } from "./ollama";
import { OpenRouterAdapter } from "./openrouter";
import { ProviderError, safeProviderError } from "./errors";
import { authMode } from '../auth/policy';
export function provider(id: string): ProviderAdapter {
  if (authMode() !== 'local') throw new ProviderError('configuration');
  if (id === "ollama") return new OllamaAdapter(process.env.OLLAMA_BASE_URL);
  if (id === "gemini")
    return new GeminiAdapter(
      process.env.GEMINI_API_KEY ?? "",
      process.env.GEMINI_MODEL ?? "",
      process.env.GEMINI_FREE_TIER_CONFIRMED === "true",
    );
  if (id === "groq")
    return new GroqAdapter(
      process.env.GROQ_API_KEY ?? "",
      process.env.GROQ_MODEL ?? "",
    );
  if (id === "openrouter")
    return new OpenRouterAdapter(
      process.env.OPENROUTER_API_KEY ?? "",
      process.env.OPENROUTER_MODEL ?? "",
      process.env.OPENROUTER_PAID_MODEL_CONFIRMED === "true",
    );
  throw new ProviderError("configuration");
}
export async function providerStatuses(
  signal: AbortSignal,
): Promise<ProviderStatus[]> {
  if (authMode() !== 'local') return [];
  return Promise.all(
    (["gemini", "groq", "openrouter", "ollama"] as const).map(async (id) => {
      const base = {
        id,
        name:
          id === "gemini"
            ? "Google Gemini"
            : id === "groq"
              ? "Groq"
              : id === "openrouter"
                ? "OpenRouter"
                : "Local Ollama",
      };
      if (id === "gemini" && !process.env.GEMINI_API_KEY)
        return {
          ...base,
          available: false,
          models: [],
          message:
            "Enter GEMINI_API_KEY privately in .env.local, then restart Forge.",
        };
      if (id === "groq" && !process.env.GROQ_API_KEY)
        return {
          ...base,
          available: false,
          models: [],
          message:
            "Enter GROQ_API_KEY privately in .env.local, then restart Forge.",
        };
      if (id === "openrouter" && !process.env.OPENROUTER_API_KEY)
        return {
          ...base,
          available: false,
          models: [],
          message:
            "Enter a fresh OPENROUTER_API_KEY privately in .env.local, then restart Forge.",
        };
      if (
        id === "openrouter" &&
        process.env.OPENROUTER_PAID_MODEL_CONFIRMED !== "true"
      )
        return {
          ...base,
          available: false,
          models: [],
          message:
            "Confirm the selected model's current pricing before enabling paid OpenRouter requests.",
        };
      try {
        const models = await provider(id).listModels(signal);
        const selectedModel =
          id === "gemini"
            ? process.env.GEMINI_MODEL
            : id === "groq"
              ? process.env.GROQ_MODEL
              : id === "openrouter"
                ? process.env.OPENROUTER_MODEL
                : models[0]?.id;
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
              : id === "groq"
                ? "GROQ_MODEL was not found in the current model catalog."
                : id === "openrouter"
                  ? "OPENROUTER_MODEL was not found in the current model catalog."
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
