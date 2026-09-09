import { build } from "esbuild";
import { rm, mkdir, writeFile, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// Monaco's published prebuilt assets vendor an older DOMPurify. Bundle source
// and redirect that vendored module to our audited, pinned dependency instead.
await rm("public/monaco", { recursive: true, force: true });
await mkdir("public/monaco", { recursive: true });
const result = await build({
  entryPoints: {
    editor: "scripts/editor-entry.mjs",
    worker: "node_modules/monaco-editor/esm/vs/editor/editor.worker.js",
    typescript:
      "node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js",
    css: "node_modules/monaco-editor/esm/vs/language/css/css.worker.js",
    json: "node_modules/monaco-editor/esm/vs/language/json/json.worker.js",
    html: "node_modules/monaco-editor/esm/vs/language/html/html.worker.js",
  },
  outdir: "public/monaco",
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  metafile: true,
  loader: { ".ttf": "file" },
  plugins: [
    {
      name: "patched-sanitizer",
      setup(builder) {
        builder.onResolve({ filter: /dompurify\/dompurify\.js$/ }, () => ({
          path: require.resolve("dompurify"),
        }));
      },
    },
  ],
});
const inputs = Object.keys(result.metafile.inputs);
if (
  inputs.some((p) =>
    p.includes("monaco-editor/esm/vs/base/browser/dompurify/"),
  ) ||
  !inputs.some((p) => p.includes("node_modules/dompurify/dist/"))
)
  throw new Error("Editor sanitizer override was not applied");
await writeFile(
  "public/monaco/build-info.json",
  JSON.stringify({ sanitizer: "DOMPurify 3.4.15", sourceBundle: true }),
);

for (const [source, name] of [
  ["node_modules/monaco-editor/LICENSE", "LICENSE.monaco.txt"],
  ["node_modules/monaco-editor/ThirdPartyNotices.txt", "ThirdPartyNotices.txt"],
  ["node_modules/dompurify/LICENSE", "LICENSE.dompurify.txt"],
  ["node_modules/dompurify/LICENSE-MPL", "LICENSE-MPL.txt"],
])
  await copyFile(source, `public/monaco/${name}`);
