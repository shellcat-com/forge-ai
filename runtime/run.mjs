import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
for (let i = 0; !existsSync("/tmp/forge-ready"); i++) {
  if (i > 600) process.exit(1);
  await delay(100);
}
async function run(command, args, timeout) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      env: {
        PATH: "/usr/local/bin:/usr/bin:/bin",
        HOME: "/tmp",
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
        NODE_OPTIONS: "--max-old-space-size=1200",
      },
    });
    const timer = timeout
      ? setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("Stage timed out"));
        }, timeout)
      : undefined;
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error("Stage failed"));
    });
    process.once("SIGTERM", () => child.kill("SIGTERM"));
  });
}
try {
  console.log("Installing locked dependencies offline.");
  await run(
    "npm",
    [
      "ci",
      "--offline",
      "--ignore-scripts",
      "--cache=/opt/npm-cache",
      "--logs-dir=/tmp/npm-logs",
      "--no-audit",
      "--no-fund",
    ],
    120000,
  );
  console.log("Building generated application.");
  await run(
    "node",
    ["node_modules/next/dist/bin/next", "build", "--webpack"],
    180000,
  );
  console.log("Starting application.");
  await run(
    "node",
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "0.0.0.0",
      "--port",
      "3000",
    ],
    0,
  );
} catch {
  console.error("Workspace stage failed. See preceding build output.");
  process.exit(1);
}
