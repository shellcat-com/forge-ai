import {
  mkdtemp,
  mkdir,
  copyFile,
  cp,
  writeFile,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Build and upload an explicit allowlist, never the working tree or its environment files.
const root = fileURLToPath(new URL("../", import.meta.url));
const result = spawnSync(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "build", "--outDir", "dist-cloud"],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, VITE_FORGE_AUTH_ENABLED: "true" },
  },
);
if (result.status !== 0) process.exit(result.status || 1);
const stage = await mkdtemp(join(tmpdir(), "forge-cloud-vercel-"));
await mkdir(join(stage, "api"));
await mkdir(join(stage, "server/cloud"), { recursive: true });
await cp(join(root, "dist-cloud"), join(stage, "public"), { recursive: true });
for (const name of [
  "app",
  "auth",
  "contracts",
  "store",
  "vercel",
  "account-deletion",
  "auth-proxy",
  "connections",
])
  await copyFile(
    join(root, `server/cloud/${name}.mjs`),
    join(stage, `server/cloud/${name}.mjs`),
  );
await copyFile(
  join(root, "server/provider.mjs"),
  join(stage, "server/provider.mjs"),
);
await writeFile(
  join(stage, "api/index.mjs"),
  "export { default } from '../server/cloud/vercel.mjs'\n",
);
const lock = JSON.parse(
  await readFile(join(root, "package-lock.json"), "utf8"),
);
const dependencies = Object.fromEntries(
  ["pg", "jose", "zod", "@neondatabase/auth"].map((name) => [
    name,
    lock.packages[`node_modules/${name}`].version,
  ]),
);
await writeFile(
  join(stage, "package.json"),
  JSON.stringify(
    {
      name: "forge-cloud-accounts",
      private: true,
      type: "module",
      engines: { node: "24.x" },
      dependencies,
    },
    null,
    2,
  ),
);
await writeFile(
  join(stage, "vercel.json"),
  JSON.stringify(
    {
      framework: null,
      buildCommand: "",
      outputDirectory: "public",
      functions: { "api/index.mjs": { maxDuration: 150 } },
      rewrites: [{ source: "/api/:path*", destination: "/api/index" }],
      headers: [
        {
          source: "/(.*)",
          headers: [
            { key: "X-Content-Type-Options", value: "nosniff" },
            {
              key: "Referrer-Policy",
              value: "strict-origin-when-cross-origin",
            },
            { key: "X-Frame-Options", value: "DENY" },
          ],
        },
      ],
    },
    null,
    2,
  ),
);
console.log(`Cloud deployment package: ${stage}`);
console.log(
  "No secrets included. Configure the target server environment and verify live accounts before production promotion.",
);
