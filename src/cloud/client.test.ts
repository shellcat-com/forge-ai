// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { exchangeOAuthVerifier, readSessionCredentials } from "./client";

afterEach(() => vi.unstubAllGlobals());

it("keeps the live session credential separate from the Neon JWT", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      Response.json(
        { session: { token: "opaque-session-credential" } },
        { headers: { "set-auth-jwt": "signed.jwt.credential" } },
      ),
    );
  vi.stubGlobal("fetch", fetcher);
  expect(
    await readSessionCredentials("https://auth.example.test/auth"),
  ).toEqual({
    sessionToken: "opaque-session-credential",
    token: "signed.jwt.credential",
  });
  expect(fetcher).toHaveBeenCalledWith(
    new URL(
      "https://auth.example.test/auth/get-session?disableCookieCache=true",
    ),
    expect.objectContaining({ credentials: "include", cache: "no-store" }),
  );
});

it.each([
  [null, "jwt"],
  [{ session: { token: "opaque" } }, null],
  [{ session: { token: "" } }, "jwt"],
])("rejects incomplete session credentials", async (body, jwt) => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json(body, { headers: jwt ? { "set-auth-jwt": jwt } : {} }),
      ),
  );
  await expect(
    readSessionCredentials("https://auth.example.test/auth"),
  ).rejects.toMatchObject({
    status: 401,
  });
});

it("reports identity service failures as unavailable", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new TypeError("network unavailable")),
  );
  await expect(
    readSessionCredentials("https://auth.example.test/auth"),
  ).rejects.toMatchObject({
    status: 503,
  });
});

it("exchanges OAuth verifier only on the app origin and removes it from navigation history", async () => {
  history.replaceState(
    null,
    "",
    "/?neon_auth_session_verifier=one-time-verifier#/login",
  );
  const fetcher = vi
    .fn()
    .mockResolvedValue(Response.json({ session: { token: "opaque" } }));
  vi.stubGlobal("fetch", fetcher);
  await exchangeOAuthVerifier(location.origin + "/api/auth");
  expect(location.search).toBe("");
  expect(fetcher).toHaveBeenCalledWith(
    expect.any(URL),
    expect.objectContaining({ credentials: "include", cache: "no-store" }),
  );
  expect(
    fetcher.mock.calls[0][0].searchParams.get("neon_auth_session_verifier"),
  ).toBe("one-time-verifier");
});
it("discards a failed OAuth verifier and reports sign-in failure", async () => {
  history.replaceState(null, "", "/?neon_auth_session_verifier=expired#/login");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(null)));
  await expect(
    exchangeOAuthVerifier(location.origin + "/api/auth"),
  ).rejects.toMatchObject({ status: 401 });
  expect(location.search).toBe("");
});
