# Design library, MCP, and backend integration

Implemented September 11, 2026. This is an incremental integration release, not feature parity with Bolt, Replit, or Emergent.

## Available in Forge

- `#/design-library` loads Parable's live templates and components over MCP. The catalog is validated and cached for five minutes. Search by description and filter by framework or category. Template thumbnails are attributed original Parable previews.
- Start with this design saves the reference description into a new local or account brief. The existing provider generation receives that brief. Forge does not claim it has fetched or installed source code from a URL in the prompt.
- Source guides contain registry installation or template clone commands. They download for review; Forge does not execute them.
- `#/integrations` discovers tools from Parable and host-configured Streamable HTTP MCP servers. Initialization, JSON/SSE responses, sessions, pagination, request timeouts, bounded responses, and error handling are supported. No arbitrary custom tools are executed.
- Custom MCP configuration can be exported for another client. Exporting configuration does not establish an authenticated connection.
- A host-configured Supabase Auth check tests the publishable key against `/auth/v1/settings`. It does not verify a database schema, policies, storage, or end-user sign-in.
- The Supabase starter ZIP is an independent Vite app with real email/password Auth and private notes create/read/update/delete. Its SQL enables RLS, explicit grants, and owner checks on every operation. Apply and verify it in your own development project.

The original five design studies, local persistence, cloud account features, and provider connections retain their existing roles. Generated single-document frontends remain separate from the backend starter and the gated engine.

## Host configuration

Run the existing API and frontend commands after installing the repository dependencies:

```sh
npm run api
npm run dev
```

Cloud hosts use the existing cloud API instead. Cloud integration endpoints retain account authentication, same-origin checks, and the existing account request limit. The local API retains its loopback Host and Origin restrictions.

Parable needs no credential. For additional servers, configure the API host environment:

```dotenv
FORGE_MCP_SERVERS=[{"id":"my-library","name":"My library","url":"https://example.com/mcp","tokenEnv":"MY_LIBRARY_TOKEN"}]
MY_LIBRARY_TOKEN=YOUR_HOST_SECRET
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

Restart the API after changing configuration. Omit `tokenEnv` for public servers. Credentials are never returned by the configuration endpoint. Redirects are rejected to prevent forwarding a bearer token elsewhere. Only configured server IDs are accepted from the browser; it cannot choose a destination URL, headers, or tool name. Use the `sb_publishable_` key format for the Supabase check, never secret/service-role keys.

Custom host servers and their discovered metadata are shared with authenticated users on that host. Use a credential scoped to metadata that those users may see. Per-user MCP credentials, OAuth, permission grants, and custom tool execution require additional work.

## Completion audit

| Capability | Forge status | Remaining acceptance criteria |
| --- | --- | --- |
| Designs beyond five presets | Custom-first briefs with freeform style notes and references; optional presets and live Parable discovery | Actual source installation and multi-file rendering in the generation engine |
| MCP connections | Public/host-token Streamable HTTP discovery | Per-user OAuth, encrypted credential lifecycle, tool permissions and approved execution |
| Supabase | Auth reachability check and runnable independent starter | Project provisioning, live user journeys, storage/realtime, schema lifecycle, project-specific binding |
| Provider API keys | Existing encrypted DeepSeek/NVIDIA connections | End-to-end paid provider checks with an authorized configured account |
| Full-stack generation | Existing gated engine plus separate frontend generation | Complete engine acceptance gates, runtime isolation, persistent artifacts, database/preview integration |
| GitHub, Figma, Stripe, Slack, Notion, Linear | MCP metadata discovery when configured; no native adapters | Service-specific OAuth, least-privilege scopes, real operations, retries, revocation, and end-to-end tests |
| Deployment and custom domains | No production release performed | Authorized host, secrets, build/publish checks, health verification and rollback |
| Voice/audio input | Not implemented by this change | Capture/transcription flow, permission UX, cancellation and privacy controls |

No audio or video recording was supplied. Research used official written documentation and the live Parable endpoint, not a claim of having watched private product sessions.

## Verification

Focused tests are in `server/integrations.test.mjs` and `src/integrations/*.test.ts`. The Supabase SQL test runs real PostgreSQL-compatible queries in PGlite with two identities and an anonymous role; it is not a live hosted Supabase account test.

The read-only browser harness is `tests/harness/integrations-view.html` with `scripts/serve-integrations-harness.mjs`. It uses the real integration module and live public catalog, with a test-only brief callback that explicitly does not persist. Use a Vite development server on port 5179 with `/api` proxied to port 3015 for this harness. Do not expose the harness as a production API.

Required release gate remains `npm run verify` plus local and cloud project creation/generation flows. See `docs/integration-validation.md` for the actual checks completed in this environment and unresolved limitations.

## References reviewed

- [Parable source and catalog contract](https://github.com/shellcat-com/parable)
- [Parable website](https://parable-three.vercel.app/)
- [Bolt MCP connections, authentication, and tool controls](https://support.bolt.new/building/using-bolt/connect-mcp)
- [Bolt Supabase integration](https://support.bolt.new/integrations/supabase)
- [Replit MCP connections](https://docs.replit.com/build/connect-via-mcp)
- [Emergent Supabase integration](https://help.emergent.sh/supabase-integration)
- [Emergent platform features](https://help.emergent.sh/articles/272715-features-and-tools)
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase Auth sign-up](https://supabase.com/docs/reference/javascript/auth-signup)
- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [MCP Streamable HTTP specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
