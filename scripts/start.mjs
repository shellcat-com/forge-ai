import { cpSync } from "node:fs";
import { spawn } from "node:child_process";
const args = process.argv.slice(2);
if (
  args.length &&
  (args.length !== 2 || args[0] !== "--port" || !/^\d+$/.test(args[1]))
) {
  throw new Error("Usage: npm start -- [--port PORT]");
}
const port = Number(args[1] || process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Port must be between 1024 and 65535.");
cpSync("public", ".next/standalone/public", { recursive: true });
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
const child = spawn(process.execPath, [".next/standalone/server.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    NEXT_TELEMETRY_DISABLED: "1",
  },
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
