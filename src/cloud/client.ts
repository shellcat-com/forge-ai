import { createAuthClient } from "@neondatabase/auth";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function readSessionCredentials(authUrl: string) {
  // Neon SDK 0.5 replaces session.token with the set-auth-jwt header. Read the
  // original response so the API receives both the JWT and the opaque session
  // credential needed to enforce immediate revocation after sign-out.
  const url = new URL(authUrl.replace(/\/$/, "") + "/get-session");
  url.searchParams.set("disableCookieCache", "true");
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new ApiError(503, "Could not check your session. Please retry.");
  }
  if (!response.ok)
    throw new ApiError(
      response.status === 401 ? 401 : 503,
      "Could not check your session. Please retry.",
    );
  let session;
  try {
    session = await response.json();
  } catch {
    throw new ApiError(503, "Could not check your session. Please retry.");
  }
  const sessionToken = session?.session?.token;
  const token = response.headers.get("set-auth-jwt");
  if (typeof sessionToken !== "string" || !sessionToken || !token)
    throw new ApiError(401, "Sign in to continue.");
  return { sessionToken, token };
}
export async function exchangeOAuthVerifier(authUrl: string) {
  const callback = new URL(location.href);
  const verifier = callback.searchParams.get("neon_auth_session_verifier");
  if (!verifier || new URL(authUrl).origin !== location.origin) return;
  // Exchange the managed one-time verifier with its HttpOnly challenge cookie.
  // Remove it from the address immediately so later navigation cannot leak it.
  callback.searchParams.delete("neon_auth_session_verifier");
  history.replaceState(null, "", callback);
  const url = new URL(authUrl + "/get-session");
  url.searchParams.set("neon_auth_session_verifier", verifier);
  url.searchParams.set("disableCookieCache", "true");
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok || !(await response.json())?.session)
    throw new ApiError(
      401,
      "Sign-in could not be completed. Please sign in again.",
    );
}
export async function connect() {
  const response = await fetch("/api/config", {
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok)
    throw new Error("Account services are unavailable. Please retry.");
  const config = await response.json();
  if (
    config.mode !== "cloud" ||
    typeof config.authUrl !== "string" ||
    !config.authUrl.startsWith("https://")
  )
    throw new Error("Account services need configuration.");
  await exchangeOAuthVerifier(config.authUrl);
  const auth = createAuthClient(config.authUrl);
  const socialProviders: ("google" | "github")[] = Array.isArray(
    config.socialProviders,
  )
    ? ([
        ...new Set(
          config.socialProviders.filter(
            (value: unknown) => value === "google" || value === "github",
          ),
        ),
      ] as ("google" | "github")[])
    : [];
  async function api<T>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    const { sessionToken, token } = await readSessionCredentials(
      config.authUrl,
    );
    const r = await fetch("/api" + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Forge-Session": sessionToken,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(
        path === "/generate" ||
          (path.startsWith("/connections/") && method === "POST")
          ? 130000
          : 15000,
      ),
    });
    const result = await r.json();
    if (!r.ok)
      throw new ApiError(
        r.status,
        result.error || "Request failed. Please retry.",
      );
    return result as T;
  }
  return {
    auth,
    api,
    socialProviders,
    accountDeletionEnabled: config.accountDeletionEnabled === true,
  };
}
export type Connection = Awaited<ReturnType<typeof connect>>;
export interface Brief {
  name: string;
  prompt: string;
  template: string;
  presetId: string;
}
export interface Project extends Brief {
  id: string;
  revision: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface Onboarding {
  version: 1;
  stage: number;
  revision: number;
  completedAt: string | null;
  projectId: string | null;
  draft: {
    name: string;
    audience: string;
    outcome: string;
    features: string;
    presetId: string;
  };
}
export interface Me {
  user: { id: string; email: string; name: string };
  onboarding: Onboarding;
}
