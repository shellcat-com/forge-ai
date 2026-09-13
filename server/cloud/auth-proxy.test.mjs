import { createServer } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { createCloudHandler } from "./app.mjs";
import { createAuthProxy } from "./auth-proxy.mjs";
let server;
const origin = "https://forge.test";
afterEach(async () => {
  vi.unstubAllGlobals();
  if (server) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
async function setup(proxy) {
  const authProxy = createAuthProxy({
    baseUrl: "https://auth.test/auth",
    origin,
    secret: "synthetic-cookie-signing-secret-32-characters",
    proxy,
  });
  server = createServer(
    createCloudHandler({ origin, authProxy, verify: vi.fn(), store: {} }),
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${server.address().port}`;
}
it("passes only allowed auth requests, cookies and opaque/JWT responses through without caching", async () => {
  const proxy = vi.fn(async () =>
    Response.json(
      { session: { token: "opaque" } },
      {
        headers: {
          "set-auth-jwt": "signed.jwt",
          "set-cookie":
            "__Secure-neon-auth.session_token=synthetic; Path=/; HttpOnly; Secure; SameSite=Lax",
        },
      },
    ),
  );
  const url = await setup(proxy);
  const response = await fetch(
    url + "/api/auth/get-session?disableCookieCache=false",
    {
      headers: {
        Cookie: "__Secure-neon-auth.session_token=synthetic",
        Authorization: "untrusted",
        "x-neon-auth-middleware": "untrusted",
      },
    },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  expect(response.headers.get("set-auth-jwt")).toBe("signed.jwt");
  expect(response.headers.get("cache-control")).toBe("no-store");
  const options = proxy.mock.calls[0][0];
  expect(options.request.url).toContain("disableCookieCache=true");
  expect(options.request.headers.get("authorization")).toBeNull();
  expect(options.request.headers.get("x-neon-auth-middleware")).toBeNull();
  expect(options.request.headers.get("origin")).toBe(origin);
  expect(options.sameSite).toBe("lax");
});
it.each([
  ["/api/auth/sign-in/email", "POST", {}, "{}", 403],
  [
    "/api/auth/sign-in/email",
    "POST",
    { Origin: "https://evil.test" },
    "{}",
    403,
  ],
  [
    "/api/auth/get-session",
    "GET",
    { "Sec-Fetch-Site": "cross-site" },
    undefined,
    403,
  ],
  [
    "/api/auth/admin/delete-user",
    "POST",
    { Origin: origin, "Content-Type": "application/json" },
    "{}",
    404,
  ],
  [
    "/api/auth/get-session",
    "POST",
    { Origin: origin, "Content-Type": "application/json" },
    "{}",
    404,
  ],
  [
    "/api/auth/sign-in/email",
    "POST",
    { Origin: origin, "Content-Type": "text/plain" },
    "{}",
    415,
  ],
  [
    "/api/auth/sign-in/email",
    "POST",
    { Origin: origin, "Content-Type": "application/json" },
    "x".repeat(17000),
    413,
  ],
])(
  "rejects invalid auth transport before contacting identity provider",
  async (path, method, headers, body, status) => {
    const proxy = vi.fn();
    const url = await setup(proxy);
    expect((await fetch(url + path, { method, headers, body })).status).toBe(
      status,
    );
    expect(proxy).not.toHaveBeenCalled();
  },
);
it("fails configuration without a strong cookie signing secret", () => {
  expect(() => createAuthProxy({ secret: "short" })).toThrow("signing secret");
});

it("uses the managed SDK to make cookies first-party while preserving HttpOnly and Secure", async () => {
  const nativeFetch = globalThis.fetch;
  const url = await setup();
  const upstream = vi.fn(async () =>
    Response.json(
      { status: true },
      {
        headers: {
          "set-cookie":
            "__Secure-neon-auth.session_challenge=synthetic-challenge; Path=/; HttpOnly; Secure; SameSite=None; Partitioned",
        },
      },
    ),
  );
  vi.stubGlobal("fetch", upstream);
  const response = await nativeFetch(url + "/api/auth/sign-in/social", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "google",
      callbackURL: origin + "/#/login",
    }),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie");
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/Secure/i);
  expect(cookie).toMatch(/SameSite=Lax/i);
  expect(cookie).not.toMatch(/Partitioned|Domain=/i);
  expect(String(upstream.mock.calls[0][0])).toBe(
    "https://auth.test/auth/sign-in/social",
  );
});
