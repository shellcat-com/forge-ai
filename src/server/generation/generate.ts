import { provider, providerStatuses } from "../providers/registry";
import { ProviderError, safeProviderError } from "../providers/errors";
import { applyBatch } from "./files";
import { normalizeClientDirectives } from "./normalize";
import type { FileMap } from "./files";
const schema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "operations"],
  properties: {
    summary: {
      type: "string",
    },
    operations: {
      type: "array",
      minItems: 1,
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "path", "content"],
        properties: {
          type: {
            const: "write",
          },
          path: {
            enum: ["app/page.tsx", "app/globals.css"],
          },
          content: {
            type: "string",
          },
        },
      },
    },
  },
};
export async function generateFiles(
  input: { provider: string; model: string; prompt: string },
  files: FileMap,
  event: (type: string, message: string) => Promise<void>,
) {
  const prompt = `Current editable files (reference only; rewrite them to satisfy the request): ${JSON.stringify(files)}\n\nYOUR TASK: ${input.prompt}\nImplement the requested visible changes. Do not simply repeat the current files. Return a complete JSON object containing summary and operations. Each operation is {"type":"write","path":"app/page.tsx" or "app/globals.css","content":"complete file text"}.`;
  if (prompt.length > 24000)
    throw new Error(
      "Project exceeds the first-milestone generation context budget. Use the editor for this change.",
    );
  async function attempt(id: string, model: string) {
    await event("provider", `Generating with ${id} / ${model}.`);
    let output = "";
    let lastUpdate = 0;
    try {
      for await (const part of provider(id).generate(
        {
          model,
          prompt,
          maxTokens: 4096,
          json: true,
          schema,
          system:
            'You build small, polished, functional Next.js applications. Return only JSON file operations, never markdown or explanations. For app/page.tsx use a default React component with "use client" first and React hooks as needed. Only import react; do not add dependencies, images, fonts, external URLs or files. Use CSS in app/globals.css. The existing SQLite backend GET /api/items returns [{id,title,body}], POST /api/items accepts {title,body} and DELETE /api/items?id=ID deletes an item. Preserve this backend; implement real loading/saving with fetch and error handling. Keep code concise and type-safe; define types for state. Do not invent server endpoints. Never execute commands or change configuration.',
        },
        AbortSignal.timeout(180000),
      )) {
        if (part.type === "delta") {
          output += part.text;
          if (output.length > 256000) throw new ProviderError("limit");
          if (Date.now() - lastUpdate > 1500) {
            await event(
              "progress",
              `Receiving file operations · ${output.length.toLocaleString()} characters`,
            );
            lastUpdate = Date.now();
          }
        }
      }
    } catch (error) {
      throw safeProviderError(error);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch {
      throw new Error(
        "The model did not return valid file operations. The working revision is unchanged.",
      );
    }
    try {
      const batch = applyBatch(files, parsed);
      const normalized = normalizeClientDirectives(batch.files);
      if (normalized.corrected)
        await event(
          "repair",
          "Corrected an unquoted React client directive before building.",
        );
      return { ...batch, files: normalized.files };
    } catch {
      throw new Error(
        "Generated file operations failed validation. The working revision is unchanged.",
      );
    }
  }
  try {
    return await attempt(input.provider, input.model);
  } catch (error) {
    if (
      input.provider === "gemini" &&
      error instanceof ProviderError &&
      ["quota", "unavailable", "timeout"].includes(error.code)
    ) {
      const local = (await providerStatuses(AbortSignal.timeout(6000))).find(
        (p) => p.id === "ollama" && p.available,
      );
      if (local?.selectedModel) {
        await event(
          "fallback",
          `Gemini unavailable. Discarding partial output and switching to local Ollama / ${local.selectedModel}.`,
        );
        return attempt("ollama", local.selectedModel);
      }
    }
    throw error;
  }
}
