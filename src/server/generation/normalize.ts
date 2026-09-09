import type { FileMap } from "./files";
// A narrow correction for an observed model error. No arbitrary source rewriting.
export function normalizeClientDirectives(files: FileMap): {
  files: FileMap;
  corrected: boolean;
} {
  let corrected = false;
  const result = Object.fromEntries(
    Object.entries(files).map(([path, content]) => {
      if (path.endsWith(".tsx") && /^\s*use client;\s*\r?\n/.test(content)) {
        corrected = true;
        return [
          path,
          content.replace(/^\s*use client;\s*\r?\n/, '"use client";\n'),
        ];
      }
      return [path, content];
    }),
  );
  return { files: result, corrected };
}
