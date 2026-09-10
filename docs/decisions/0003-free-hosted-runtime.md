# Free hosted integration

The user approved this replacement architecture on 2026-09-10. Infrastructure
and test spending are now zero; the earlier Hetzner and dollar budgets are revoked.
This is a personal, non-commercial installation within provider free quotas.

Keep Better Auth as the account authority and Neon as the PostgreSQL store.
Vercel Hobby hosts the existing Next.js application and Node control endpoints.
Cloudflare Workers Free coordinates small, authenticated job messages and private
preview requests. PostgreSQL remains the durable job authority; delivery is not
a second job state machine. Vercel Sandbox's Hobby allocation replaces the
dedicated KVM host for the hosted runtime. Preserve the Firecracker adapter for
installations that explicitly configure it. No generated code runs on the Mac,
trusted control process, Cloudflare Worker, or Vercel's ordinary build service.

The managed runtime must enforce reviewed source/toolchain binding, restricted
egress, no exposed application ports, authenticated private preview transport,
bounded resources, cancellation, stale-worker fencing and independent cleanup.
Implement and test these controls before enabling live admission. A managed
microVM product name is not evidence that this installation passes containment.

Users supply supported Gemini, Groq or OpenRouter keys through authenticated
connections. No operator model key or paid fallback. Published database apps
default to creator-only access. Publication requires a separate user hosting
connection and approved source/exposure; it must never overwrite Forge.

Provider-issued HTTPS hostnames satisfy the no-domain-purchase requirement.
Use the existing real email delivery boundary with privately configured Gmail
credentials for this small installation; synthetic mail tests do not establish
delivery. Never request or record secrets in chat or evidence.

Retain progress when free capacity is unavailable. Verify the actual account
plan before creating resources; stop instead of buying usage. Do not downgrade
unrelated services. Quota exhaustion, missing credentials and failed acceptance
must remain visible, not become fabricated success.

The existing integration branch and PR remain the delivery vehicle. Migrations
0001–0003 remain unchanged. Engine 0004 connects existing Better Auth identity;
0005–0007 retain the reserved BYOK/storage/preview allocations. No second
identity provider or parallel queue is introduced. Production promotion requires
the full A–P acceptance evidence and successful recorded workflow. Do not merge.
