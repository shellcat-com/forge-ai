# Task 08 demo runbook

Status: live engine demonstration blocked. This procedure is not a recording of completed generation. Current supporting publisher tests use synthetic authority and runner receipts. The public fallback is platform-authored UI and says the builder is unavailable.

## Reproduce independent work

Use Node 24.20.0, the committed root lockfile, and native PostgreSQL tools on PATH. In a clean clone, run `npm ci` before verification. Do not read real database/provider secrets for test setup.

```sh
npm run verify
npm run test:db:control
npx vitest run tests/engine/publishing.test.ts tests/engine/e4-control-http.test.ts tests/engine/e2-control-integration.test.ts tests/engine/e4-repair-integration.test.ts
npx tsx scripts/publishing/prepare-frontend.tsx /tmp/forge-frontend-new-stage
node scripts/publishing/check-public.mjs /tmp/forge-frontend-browser --stage /tmp/forge-frontend-new-stage
```

The packager emits only the shared temporary unavailable view, theme script, CSS and self-hosted fonts. It emits neither the Next.js API nor the application/worker runtime. `/hosting` in the canonical Next.js app shows the same component. Keep the canonical app as the future hosting target; this static fallback is not another builder implementation. The JSON receipt marks source commit, dirty-tree status, component/static/config digests and `generatedPortfolio: false`. Deploy only a clean committed build.

## Actual owner demonstration — NOT RUN

1. Record exact configured Task 01–07 commits, verified template/lock/policy/image hashes, real owner identity, control/object storage and isolated runtime readiness. Select supported provider/model, secret reference, dated prices, token bound and explicit total spend ceiling. Never submit raw keys to this report, source or browser storage. Missing input stops live dispatch, not local verification.
2. Use owner-supplied/verified profile claims or the following brief: “Create a small portfolio clearly titled Demonstration portfolio. Use illustrative projects marked Demonstration. Include about and projects sections. Make no employer, qualification, testimonial, client or contact claims. Do not create a contact form, external network requests or an invented email address.” This is a brief, not a hand-authored substitute website.
3. Submit through the authenticated Forge engine. Record job/plan identity and provider request/usage evidence in private storage. Review the actual plan and approve its displayed hash. Generate source through the budgeted provider adapter. Preserve complete source manifest, job/template/model/prompt identifiers and source ZIP hash. Record no raw keys or private prompts in public telemetry.
4. Review actual file changes, protected template and commands. Approve the exact execution review. Task 02 runs checks inside approved isolation; retain authenticated verification and collector hashes. If repairs are needed, show the failed check, bounded model call, changed candidate and fresh approval. Never stage a passing screenshot or execute provider source on the control/ordinary host.
5. Launch the expiring private preview through Task 07's one-use POST ticket. Confirm ownership, expiry and runtime bindings. Approve source promotion, inspect history, export exact source, then restore a prior snapshot through a new approved verification job. Disclose synthetic preview-data reset. Keep ticket/session data out of URLs and reports.
6. Separately generate the PostgreSQL task board: create/edit/complete/filter/delete tasks through the real browser; retain one row, restart only the app process and read the same row from PostgreSQL. Request priority; inspect the additive migration, approve, run fresh/prior-seeded migration tests and show existing rows with the new field. Record exact source, schema, image and sanitized external evidence. No static or native synthetic test closes this step.
7. Obtain an exact content/publication approval bound to source, build output, Vercel target and profile. The trusted authority authenticates broker evidence and rechecks current scope. `preparePortfolioPublication` rejects fixture/restore provenance and non-static output. Until the separate static profile is approved, this step remains unavailable.
8. Audit the dedicated Vercel project: exact IDs/account/name, no Git link or automatic build, no env vars/integrations/server framework. Use only existing authorized capacity, default `.vercel.app`, and prebuilt static bytes. Do not deploy the control API, keys, app DB, private preview or arbitrary server source with the portfolio.
9. Record deployment intent, source commit, receipt hash, CLI/build log and deployment ID. Inspect ambiguous operations before retry. Open the default production and immutable URLs in a fresh unauthenticated browser with no bypass token. Run the public check script and inspect all screenshots; additionally exercise portfolio-specific routes, content and assets. Its unavailable-screen assertion is specific to the Forge fallback and must not be presented as portfolio validation.

## Evidence and rollback

Public report: deployment ID, URL, source commit, source/template/build/static/config digests, sanitized build log, test commands, exact skipped/simulated/live distinctions and blockers. Source/review/private preview receipts remain scoped private artifacts; public receipts must contain only approved nonsecret references. Provider usage is real only when measured by the account adapter.

For a future existing production deployment, record the previous verified deployment ID before changing its alias. Roll back using `vercel rollback PREVIOUS_VERIFIED_DEPLOYMENT --scope TEAM`; inspect project identity and supported CLI behavior first, then verify the restored public URL. Rollback never restores a PostgreSQL database or changes the Forge source head. For the first deployment of a new dedicated static project, no prior version exists: remove that exact deployment with `vercel remove DEPLOYMENT_ID --scope TEAM --yes` if necessary, leaving unrelated projects alone. Rebuild/redeploy the same reviewed commit and receipt to reproduce it. Do not delete a project or affect another task's deployment implicitly.

Native browser zoom and native OS reduced motion need separate actual controls. The included automated browser script labels CSS 200% zoom and reduced-motion media emulation as simulations; they are not native accessibility acceptance.
