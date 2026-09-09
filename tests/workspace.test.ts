import { describe, expect, it } from "vitest";
import {
  applyBatch,
  safePath,
  validateFiles,
} from "../src/server/generation/files";
const base = {
  "app/page.tsx": "export default function Page(){return null}",
  "app/globals.css": "body{}",
};
describe("untrusted file operations", () => {
  it.each([
    "../outside",
    "app/api//items/route.ts",
    "/etc/passwd",
    "app/../../x",
    "app/..\\x",
    "package.json",
    ".env.local",
    "next.config.mjs",
    "app/page.tsx\u0000",
    "app/%2e%2e/x",
    "app/components/link",
  ])("rejects %s", (path) => expect(safePath(path)).toBe(false));
  it("applies a batch without mutating the working version", () => {
    const result = applyBatch(base, {
      summary: "Update page",
      operations: [
        { type: "write", path: "app/page.tsx", content: "new page" },
      ],
    });
    expect(result.files["app/page.tsx"]).toBe("new page");
    expect(base["app/page.tsx"]).not.toBe("new page");
  });
  it("rejects shell commands and symlink operations", () => {
    for (const operation of [
      { type: "shell", command: "echo unsafe" },
      { type: "symlink", path: "app/page.tsx", target: "/etc/passwd" },
    ])
      expect(() =>
        applyBatch(base, { summary: "bad", operations: [operation] }),
      ).toThrow();
  });
  it("rejects ambiguous batches and deletion of required files", () => {
    expect(() =>
      applyBatch(base, {
        summary: "duplicate",
        operations: [
          { type: "delete", path: "app/page.tsx" },
          { type: "write", path: "app/page.tsx", content: "x" },
        ],
      }),
    ).toThrow();
    expect(() =>
      applyBatch(base, {
        summary: "delete page",
        operations: [{ type: "delete", path: "app/page.tsx" }],
      }),
    ).toThrow();
  });
  it("rejects oversized UTF-8 file content", () =>
    expect(() =>
      validateFiles({ ...base, "app/page.tsx": "雪".repeat(22000) }),
    ).toThrow());
});
