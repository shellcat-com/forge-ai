import {
  handleAuthProxyRequest,
  resolveNeonAuthLogging,
} from "@neondatabase/auth/server";
import { HttpError } from "./contracts.mjs";

// The managed SDK owns cookie rewriting and OAuth challenge exchange. Never
// accept an upstream URL or administrative endpoint from a browser request.
const routes = new Map([
  ["get-session", "GET"],
  ["list-sessions", "GET"],
  ["list-accounts", "GET"],
  ["sign-in/email", "POST"],
  ["sign-in/social", "POST"],
  ["sign-up/email", "POST"],
  ["sign-out", "POST"],
  ["send-verification-email", "POST"],
  ["email-otp/verify-email", "POST"],
  ["request-password-reset", "POST"],
  ["reset-password", "POST"],
  ["change-password", "POST"],
  ["update-user", "POST"],
  ["revoke-session", "POST"],
  ["revoke-other-sessions", "POST"],
  ["link-social", "POST"],
  ["unlink-account", "POST"],
]);
export function createAuthProxy({
  baseUrl,
  origin,
  secret,
  proxy = handleAuthProxyRequest,
}) {
  if (typeof secret !== "string" || secret.length < 32)
    throw new Error("Authentication cookie signing secret is required.");
  const log = resolveNeonAuthLogging({ logLevel: "silent" });
  return async (req, res) => {
    const url = new URL(req.url, origin);
    const path = url.pathname.slice("/api/auth/".length);
    if (routes.get(path) !== req.method)
      throw new HttpError(404, "Unknown authentication route.");
    if (req.headers.origin && req.headers.origin !== origin)
      throw new HttpError(403, "Origin not allowed.");
    if (req.headers["sec-fetch-site"] === "cross-site")
      throw new HttpError(403, "Cross-site request denied.");
    let body;
    if (req.method === "POST") {
      if (req.headers.origin !== origin)
        throw new HttpError(403, "Origin required.");
      if (req.headers["content-type"]?.split(";")[0] !== "application/json")
        throw new HttpError(415, "JSON required.");
      body = "";
      for await (const chunk of req) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 16384)
          throw new HttpError(413, "Request is too large.");
      }
    }
    // Always consult managed sessions; cached data cannot extend a revoked session.
    if (path === "get-session")
      url.searchParams.set("disableCookieCache", "true");
    const headers = new globalThis.Headers();
    for (const name of ["cookie", "content-type", "user-agent"])
      if (typeof req.headers[name] === "string")
        headers.set(name, req.headers[name]);
    headers.set("origin", origin);
    const response = await proxy({
      request: new globalThis.Request(url, {
        method: req.method,
        headers,
        body,
        signal: AbortSignal.timeout(12000),
      }),
      path,
      baseUrl: baseUrl.replace(/\/$/, ""),
      cookieSecret: secret,
      sessionDataTtl: 0,
      sameSite: "lax",
      log,
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) res.setHeader("Set-Cookie", cookies);
    for (const name of ["content-type", "set-auth-jwt", "set-auth-token"]) {
      const value = response.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.writeHead(response.status);
    res.end(Buffer.from(await response.arrayBuffer()));
  };
}
