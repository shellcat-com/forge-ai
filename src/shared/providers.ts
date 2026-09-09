export type ProviderId = "gemini" | "ollama" | "groq" | "openrouter";
export interface ModelDescriptor {
  id: string;
  name: string;
  sizeBytes?: number;
  outputTokenLimit?: number;
}
export interface ProviderStatus {
  id: ProviderId;
  name: string;
  available: boolean;
  message: string;
  models: ModelDescriptor[];
  selectedModel?: string;
}
export type ProviderEvent =
  { type: "delta"; text: string } | { type: "done"; outputTokens?: number };
export interface GenerationRequest {
  model: string;
  prompt: string;
  system?: string;
  maxTokens: number;
  json?: boolean;
  schema?: Record<string, unknown>;
}
export interface ProviderAdapter {
  readonly id: ProviderId;
  listModels(signal: AbortSignal): Promise<ModelDescriptor[]>;
  generate(
    request: GenerationRequest,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent>;
}
export const deferredProviders = [
  { id: "groq", name: "Groq", implemented: false },
  { id: "openrouter", name: "OpenRouter", implemented: false },
] as const;
