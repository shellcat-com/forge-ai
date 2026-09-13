import pg from "pg";
import { createAuthProxy } from "./auth-proxy.mjs";
import { createCloudHandler } from "./app.mjs";
import { createVerifier } from "./auth.mjs";
import { CloudStore } from "./store.mjs";
import { ProviderConnections } from "./connections.mjs";
import { createAccountDeletion } from "./account-deletion.mjs";

// Each warm function shares a small pool. Migration credentials are never needed here.
export function createVercelHandler({
  env = process.env,
  Pool = pg.Pool,
} = {}) {
  let ready;
  const initialize = async () => {
    if (env.FORGE_AUTH_ENABLED !== "true")
      throw new Error("Cloud accounts are disabled.");
    if (!env.DATABASE_URL || !env.NEON_AUTH_BASE_URL || !env.FORGE_APP_ORIGIN)
      throw new Error("Cloud configuration is incomplete.");
    const origin = new URL(env.FORGE_APP_ORIGIN);
    const auth = new URL(env.NEON_AUTH_BASE_URL);
    if (
      origin.protocol !== "https:" ||
      origin.origin !== env.FORGE_APP_ORIGIN ||
      auth.protocol !== "https:" ||
      auth.username ||
      auth.password ||
      auth.search ||
      auth.hash
    )
      throw new Error("Cloud configuration requires exact HTTPS origins.");
    // The loopback planner has an in-memory budget, unsuitable for replicated functions.
    if (env.FORGE_HOSTED_PLANNING_ENABLED === "true")
      throw new Error(
        "Serverless planning requires a shared quota implementation.",
      );
    const authProxy = env.NEON_AUTH_COOKIE_SECRET
      ? createAuthProxy({
          baseUrl: auth.href,
          origin: origin.origin,
          secret: env.NEON_AUTH_COOKIE_SECRET,
        })
      : undefined;
    const pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 2,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
      allowExitOnIdle: true,
    });
    // An idle connection failure must not crash a warm function or log a connection secret.
    pool.on("error", () => {});
    try {
      const {
        rows: [role],
      } = await pool.query(
        "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
      );
      if (!role || role.rolsuper || role.rolbypassrls)
        throw new Error("Runtime role must enforce row security.");
      const store = new CloudStore(pool);
      return createCloudHandler({
        store,
        connections: env.FORGE_PROVIDER_ENCRYPTION_KEY
          ? new ProviderConnections({
              store,
              encryptionKey: env.FORGE_PROVIDER_ENCRYPTION_KEY,
            })
          : undefined,
        verify: createVerifier(auth.href, pool),
        origin: origin.origin,
        authUrl: authProxy ? origin.origin + "/api/auth" : auth.href,
        authProxy,
        socialProviders: (env.FORGE_AUTH_SOCIAL_PROVIDERS || "")
          .split(",")
          .map((p) => p.trim()),
        deleteAccount: createAccountDeletion({ env, pool }),
      });
    } catch (error) {
      await pool.end();
      throw error;
    }
  };
  return async (req, res) => {
    try {
      ready ||= initialize().catch((error) => {
        ready = undefined;
        throw error;
      });
      const handle = await ready;
      await handle(req, res);
    } catch {
      res.writeHead(503, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(
        JSON.stringify({
          error:
            "Account service is not configured or is temporarily unavailable.",
        }),
      );
    }
  };
}

export default createVercelHandler();
