# Combined free-hosted foundation verification

2026-09-10. This is an incomplete release milestone, not prompt-to-publication acceptance.

The combined branch includes account ownership and encrypted key management, actual restricted Neon role installation, the disabled bounded Cloudflare scheduler transport, and the Gmail delivery adapter. `npm run verify` passed lint, strict types, 911 tests (5 optional skips) and the production build. The focused Gmail/native-auth run passed 24 tests; its SMTP and TLS are explicit fixtures. Native concurrent delivery reservations accepted exactly 50 of 80 attempts and reset on the next UTC day.

The Gmail adapter uses fixed verified TLS, a dedicated private app password, one validated recipient, exact-origin authentication links, an absolute ten-second socket deadline and a durable fifty-attempt UTC daily allowance. Unknown SMTP outcomes remain charged. It preserves existing delivery behavior unless explicitly configured. Application migration 0007 was installed in the dedicated Neon control database and its replay/hash check passed. Actual inbox verification and password recovery are pending the private credential; no real email has been sent by these tests.

The initial Gmail typecheck failed because the Node TLS type does not accept the proposed signal option. The implementation now destroys the actual socket on its absolute deadline. The failed check and passing native/combined reruns are preserved separately.

## Bounded live Sandbox probe

Vercel team `biswas07` was verified as Hobby. One real Sandbox was created in the existing Forge project with one vCPU, 2 GiB memory, a 60-second lifetime, deny-all networking, no routes and no generated source. The first request used an invalid shorthand image name and returned 404 without allocating a Sandbox. The corrected fully qualified managed image was accepted. This proves account access and automatic expiry, not build/toolchain or private preview acceptance.

Sandbox session `sbx_CXKUgZUfmUOQndP76D2GdEg4wIVt` stopped after 60,428 ms and reported 1,841 ms active CPU, zero outbound bytes and 796 inbound bytes. No application or diagnostic command was run. The named Sandbox was then deleted, with orphan-snapshot cleanup requested; a subsequent read returned 404. No public port was created. The CLI required its explicit noninteractive confirmation switch for deletion of this task's probe; the first deletion command performed no mutation.

The managed image resolved to the digest recorded in the sanitized probe evidence. Its metadata runtime field says node22 despite the requested node:24 image. No inference about the actual Node version is made because no command was executed; the future pinned toolchain qualification must verify it inside the runtime.

## Release gates and rollback

The worker transport remains disabled and has no actual outbox/lease-scoped control port. Hosted generation, private previews, per-app databases and publishing remain unimplemented composition work. Cloudflare plan visibility, private email configuration and a user-connected model key remain pending. No paid resource, model call, production promotion or merge occurred.

Keep the PR draft and the existing availability page. Roll back the optional Gmail selection by unsetting its transport configuration; preserve accounts and additive migrations. Keep enrollment/admission/worker disabled until live acceptance. Scheduler rollback is to retain its disabled configuration and remove any future dispatch binding. The probe is already deleted. Restricted Neon role and credential rollback is documented in the installation report.
