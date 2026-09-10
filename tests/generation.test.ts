import { beforeEach, expect, it, vi } from "vitest";
import { generateFiles } from "../src/server/generation/generate";
import { ProviderError } from "../src/server/providers/errors";
const registry = vi.hoisted(() => ({
  provider: vi.fn(),
  providerStatuses: vi.fn(),
}));
vi.mock("../src/server/providers/registry", () => registry);
const files = {
  "app/page.tsx": "export default function Page(){ return <h1>Before</h1>; }",
  "app/globals.css": "body{color:black}",
};
const output = JSON.stringify({
  summary: "Updated page",
  operations: [
    {
      type: "write",
      path: "app/page.tsx",
      content: "export default function Page(){ return <h1>After</h1>; }",
    },
  ],
});
beforeEach(() => {
  vi.clearAllMocks();
  registry.providerStatuses.mockResolvedValue([
    { id: "ollama", available: true, selectedModel: "local" },
  ]);
});
for (const cloudProvider of ["gemini", "groq"]) {
  for (const failure of [
    new ProviderError("quota"),
    new DOMException("timeout", "TimeoutError"),
  ]) {
    it(`discards partial ${cloudProvider} output without an unapproved fallback on ${failure.name}/${failure.message}`, async () => {
      registry.provider.mockImplementation((id: string) => ({
        async *generate() {
          if (id === cloudProvider) {
            yield { type: "delta", text: "discard this incomplete JSON" };
            throw failure;
          }
          yield { type: "delta", text: output };
          yield { type: "done" };
        },
      }));
      const events: string[] = [];
      await expect(generateFiles(
        { provider: cloudProvider, model: "cloud", prompt: "Change heading" },
        files,
        async (type) => {
          events.push(type);
        },
      )).rejects.toBeInstanceOf(Error);
      expect(files["app/page.tsx"]).toContain("Before");
      expect(events).not.toContain("fallback");
      expect(registry.provider).not.toHaveBeenCalledWith("ollama");
    });
  }
}
it("does not silently fall back for authentication errors", async () => {
  registry.provider.mockReturnValue({
    generate: () => ({
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          throw new ProviderError("authentication");
        },
      }),
    }),
  });
  await expect(
    generateFiles(
      { provider: "gemini", model: "cloud", prompt: "Change heading" },
      files,
      async () => {},
    ),
  ).rejects.toMatchObject({ code: "authentication" });
  expect(registry.providerStatuses).not.toHaveBeenCalled();
});
it("rejects unsafe structured output before it can change the workspace", async () => {
  registry.provider.mockReturnValue({
    async *generate() {
      yield {
        type: "delta",
        text: JSON.stringify({
          summary: "bad",
          operations: [{ type: "write", path: ".env.local", content: "bad" }],
        }),
      };
    },
  });
  await expect(
    generateFiles(
      { provider: "ollama", model: "local", prompt: "Change heading" },
      files,
      async () => {},
    ),
  ).rejects.toThrow("failed validation");
  expect(files["app/page.tsx"]).toContain("Before");
});
