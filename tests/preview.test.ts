import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, get } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { startPreview } from "../src/server/preview/server";
let preview: ReturnType<typeof startPreview>;
let origin: string;
let enabled = true;
const upstream = createServer((req, res) => {
  if (req.url === "/invalid") {
    res.writeHead(302, { Location: "//[" });
    res.end();
    return;
  }
  if (req.url === "/redirect") {
    res.writeHead(302, { Location: "https://example.com" });
    res.end();
    return;
  }
  if (req.url === "/backslash") {
    res.writeHead(302, { Location: "/\\example.com" });
    res.end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Set-Cookie": "forbidden=1",
    "Content-Security-Policy": "default-src *",
    "X-Secret": "hidden",
  });
  res.end(JSON.stringify(req.headers));
});
beforeAll(async () => {
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  preview = startPreview(
    () =>
      enabled
        ? {
            name: "fixture",
            network: "fixture",
            port: (upstream.address() as AddressInfo).port,
          }
        : undefined,
    0,
  );
  await once(preview, "listening");
  origin = `http://127.0.0.1:${(preview.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await Promise.all([
    new Promise<void>((r) => preview.close(() => r())),
    new Promise<void>((r) => upstream.close(() => r())),
  ]);
});
describe("preview trust boundary", () => {
  it("strips credentials in both directions and enforces its own CSP", async () => {
    const res = await fetch(origin, {
      headers: { Cookie: "control=secret", Authorization: "Bearer private" },
    });
    const headers = await res.json();
    expect(headers.cookie).toBeUndefined();
    expect(headers.authorization).toBeUndefined();
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("x-secret")).toBeNull();
    expect(res.headers.get("content-security-policy")).toContain(
      "connect-src 'self'",
    );
    expect(res.headers.get("content-security-policy")).not.toContain(
      "default-src *",
    );
  });
  it("blocks external and backslash-normalized redirects", async () => {
    expect(
      (await fetch(origin + "/invalid", { redirect: "manual" })).status,
    ).toBe(502);
    expect(
      (await fetch(origin + "/redirect", { redirect: "manual" })).status,
    ).toBe(502);
    expect(
      (await fetch(origin + "/backslash", { redirect: "manual" })).status,
    ).toBe(502);
  });
  it("rejects foreign hosts and cross-origin mutation", async () => {
    const foreignHostStatus = await new Promise<number | undefined>(
      (resolve, reject) => {
        get(origin, { headers: { Host: "attacker.example" } }, (response) => {
          response.resume();
          resolve(response.statusCode);
        }).on("error", reject);
      },
    );
    expect(foreignHostStatus).toBe(403);
    expect(
      (
        await fetch(origin, {
          method: "POST",
          headers: { Origin: "https://example.com" },
        })
      ).status,
    ).toBe(403);
  });
  it("reports unavailable runtime without proxying elsewhere", async () => {
    enabled = false;
    try {
      expect((await fetch(origin)).status).toBe(503);
    } finally {
      enabled = true;
    }
  });
});
