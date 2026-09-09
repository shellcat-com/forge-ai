export interface ProjectSummary {
  id: string;
  name: string;
  activeRevision: string | null;
}
export interface ProjectDetail {
  project: ProjectSummary;
  history: { id: string; summary: string; createdAt: string }[];
  files: Record<string, string>;
  protectedFiles: Record<string, string>;
  jobs: {
    id: string;
    kind: string;
    prompt: string;
    status: string;
    error: string | null;
    provider: string;
    model: string;
  }[];
  previewReady: boolean;
  previewUrl: string;
}
export interface TimelineEvent {
  id: number;
  type: string;
  message: string;
}
export interface ModelChoice {
  provider: "gemini" | "ollama" | "openrouter";
  model: string;
}
