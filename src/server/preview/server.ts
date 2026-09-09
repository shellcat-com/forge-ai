import { createServer, request as upstreamRequest } from "node:http";
import type { WorkspaceHandle } from "../workspaces/docker";
export const previewCsp =
  "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors http://127.0.0.1:* http://localhost:*";
function localRedirect(location: string, origin: string): boolean {
  try {
    return (
      location.startsWith("/") &&
      !location.includes("\\") &&
      new URL(location, origin).origin === origin
    );
  } catch {
    return false;
  }
}
export function startPreview(
  getHandle: () => WorkspaceHandle | undefined,
  port = 3101,
) {
  const server = createServer((request, response) => {
    response.setHeader("Content-Security-Policy", previewCsp);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    response.setHeader("Cache-Control", "no-store");
    const address = server.address();
    const origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : port}`;
    if (
      request.headers.host !== new URL(origin).host ||
      (request.headers.origin &&
        request.headers.origin !== origin &&
        !["GET", "HEAD"].includes(request.method ?? "GET"))
    ) {
      response.writeHead(403);
      response.end("Forbidden host");
      return;
    }
    const handle = getHandle();
    if (!handle) {
      response.writeHead(503, { "Content-Type": "text/plain" });
      response.end(
        "Preview is starting. Follow the generation timeline in Forge.",
      );
      return;
    }
    const proxy = upstreamRequest(
      {
        hostname: "127.0.0.1",
        port: handle.port,
        method: request.method,
        path: request.url,
        headers: {
          "content-type":
            request.headers["content-type"] ?? "application/octet-stream",
          accept: request.headers.accept ?? "*/*",
        },
        timeout: 30000,
      },
      (upstream) => {
        const location = upstream.headers.location;
        if (location && !localRedirect(location, origin)) {
          upstream.destroy();
          response.writeHead(502);
          response.end("External redirects are blocked.");
          return;
        }
        if (location) response.setHeader("Location", location);
        response.setHeader(
          "Content-Type",
          upstream.headers["content-type"] ?? "application/octet-stream",
        );
        response.writeHead(upstream.statusCode ?? 502);
        let bytes = 0;
        upstream.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 8000000) {
            upstream.destroy();
            response.destroy();
          }
        });
        upstream.on("error", () => response.destroy());
        upstream.pipe(response);
      },
    );
    let bytes = 0;
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 1000000) {
        proxy.destroy();
        response.destroy();
      }
    });
    request.on("aborted", () => proxy.destroy());
    response.on("close", () => proxy.destroy());
    proxy.on("timeout", () => proxy.destroy());
    proxy.on("error", () => {
      if (!response.headersSent) response.writeHead(502);
      response.end("Preview is not ready.");
    });
    request.pipe(proxy);
  });
  server.maxConnections = 64;
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.listen(port, "127.0.0.1");
  return server;
}
