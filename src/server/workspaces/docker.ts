import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { FileMap } from "../generation/files";
import { validateFiles } from "../generation/files";
export interface WorkspaceHandle {
  name: string;
  network: string;
  port: number;
}
export interface WorkspaceAdapter {
  create(
    files: FileMap,
    database: string | null,
    log: (text: string) => void,
  ): Promise<WorkspaceHandle>;
  snapshot(handle: WorkspaceHandle): Promise<string | null>;
  destroy(handle: WorkspaceHandle): Promise<void>;
}
export function docker(
  args: string[],
  input?: string,
  timeout = 10000,
  maxBytes = 1000000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Docker operation timed out"));
    }, timeout);
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        child.kill("SIGKILL");
        reject(new Error("Docker output limit exceeded"));
      } else stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Docker is unavailable"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0)
        reject(
          new Error(
            `Docker operation failed (${code}). ${stderr.split("\n").join(" ").slice(0, 500)}`,
          ),
        );
      else resolve(args[0] === "logs" ? stdout + stderr : stdout);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
function owned(handle: WorkspaceHandle) {
  if (
    !/^forge-run-[a-f0-9-]{36}$/.test(handle.name) ||
    handle.network !== handle.name + "-net"
  )
    throw new Error("Invalid workspace handle");
}
export class DockerWorkspace implements WorkspaceAdapter {
  async create(
    files: FileMap,
    database: string | null,
    log: (text: string) => void,
  ): Promise<WorkspaceHandle> {
    validateFiles(files);
    if (database && database.length > 11000000)
      throw new Error("Snapshot exceeds limit");
    const name = `forge-run-${randomUUID()}`;
    const handle = { name, network: name + "-net", port: 0 };
    let emitted = 0;
    try {
      await docker([
        "network",
        "create",
        "--internal",
        "--label",
        "forge.managed=true",
        handle.network,
      ]);
      await docker([
        "create",
        "--name",
        name,
        "--label",
        "forge.managed=true",
        "--network",
        handle.network,
        "--publish",
        "127.0.0.1::3000",
        "--log-driver=json-file",
        "--log-opt=max-size=2m",
        "--log-opt=max-file=1",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--memory=2560m",
        "--memory-swap=2560m",
        "--cpus=2",
        "--pids-limit=128",
        "--ulimit",
        "fsize=268435456:268435456",
        "--tmpfs",
        "/workspace:rw,exec,size=805306368,mode=1777",
        "--tmpfs",
        "/tmp:rw,size=67108864,mode=1777",
        "forge-workspace:local",
      ]);
      await docker(["start", name]);
      await docker(
        ["exec", "-i", name, "node", "/opt/forge/write.mjs"],
        JSON.stringify({ files, database }),
        15000,
      );
      const relay = name + "-relay";
      await docker([
        "create",
        "--name",
        relay,
        "--label",
        "forge.managed=true",
        "--network",
        "bridge",
        "--publish",
        "127.0.0.1::3000",
        "--log-driver=json-file",
        "--log-opt=max-size=2m",
        "--log-opt=max-file=1",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--memory=64m",
        "--cpus=0.25",
        "--pids-limit=32",
        "forge-workspace:local",
        "node",
        "/opt/forge/relay.mjs",
        name,
      ]);
      await docker(["network", "connect", handle.network, relay]);
      await docker(["start", relay]);
      const mapping = await docker(["port", relay, "3000/tcp"]);
      const match = mapping.trim().match(/^127\.0\.0\.1:(\d+)$/);
      if (!match) throw new Error("Invalid preview binding");
      handle.port = Number(match[1]);
      const deadline = Date.now() + 330000;
      while (Date.now() < deadline) {
        const logs = await docker(["logs", "--tail", "300", name]);
        // Logs are display-only and never interpreted as commands or trusted stage events.
        if (logs.length > emitted && emitted < 64000) {
          log(logs.slice(emitted, 64000));
          emitted = Math.min(logs.length, 64000);
        }
        const state = (
          await docker(["inspect", "--format", "{{.State.Status}}", name])
        ).trim();
        if (state === "exited" || state === "dead")
          throw new Error("Generated application failed to build or start.");
        try {
          const response = await fetch(`http://127.0.0.1:${handle.port}`, {
            signal: AbortSignal.timeout(1000),
            redirect: "error",
          });
          await response.body?.cancel();
          if (response.ok) return handle;
        } catch {
          /* Runtime may still be compiling. */
        }
        await delay(1000);
      }
      throw new Error("Workspace startup exceeded its time limit.");
    } catch (error) {
      await this.destroy(handle);
      throw error;
    }
  }
  async snapshot(handle: WorkspaceHandle): Promise<string | null> {
    owned(handle);
    const value = JSON.parse(
      await docker(
        ["exec", handle.name, "node", "/opt/forge/snapshot.mjs"],
        undefined,
        15000,
        11000000,
      ),
    );
    if (
      value.database !== null &&
      (typeof value.database !== "string" ||
        value.database.length > 11000000 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(value.database))
    )
      throw new Error("Invalid snapshot");
    return value.database;
  }
  async destroy(handle: WorkspaceHandle): Promise<void> {
    owned(handle);
    await docker(["rm", "-f", handle.name + "-relay"]).catch(() => {});
    await docker(["rm", "-f", handle.name]).catch(() => {});
    await docker(["network", "rm", handle.network]).catch(() => {});
  }
}
