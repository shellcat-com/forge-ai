export type ProviderErrorCode =
  | "authentication"
  | "quota"
  | "unavailable"
  | "timeout"
  | "cancelled"
  | "malformed"
  | "configuration"
  | "limit";
const messages: Record<ProviderErrorCode, string> = {
  authentication:
    "Provider authentication failed. Check the server-side API key.",
  quota:
    "Provider quota or rate limit reached. Wait before retrying, or select a local model.",
  unavailable:
    "The provider is unavailable. Check its status or use an installed local model.",
  timeout:
    "The provider timed out. Try a smaller request or another available model.",
  cancelled: "Request cancelled.",
  malformed: "The provider returned an incomplete or invalid stream.",
  configuration: "Provider configuration is incomplete or not permitted.",
  limit: "The provider response exceeded the configured limit.",
};
export class ProviderError extends Error {
  constructor(readonly code: ProviderErrorCode) {
    super(messages[code]);
    this.name = "ProviderError";
  }
}
export function safeProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof Error && error.name === "TimeoutError")
    return new ProviderError("timeout");
  if (error instanceof Error && error.name === "AbortError")
    return new ProviderError("cancelled");
  return new ProviderError("unavailable");
}
