# Better Auth Infrastructure configuration handoff

2026-09-10. Configuration-only handoff from the existing account-setup task. No secret value is included in this report. This is not signup, OAuth, email-delivery or live beta acceptance.

## Reported account setup

The account-setup task reports completing Better Auth Infrastructure onboarding in Firefox with the user's explicit authorization. The Forge AI project at <https://dash.better-auth.com/forge-ai> reports Online on the free Starter plan. Its configured base URL is `https://forge-personal-biswas07.vercel.app` and auth path is `/api/auth`.

The newly issued onboarding credential was entered privately into the separate Vercel Hobby verification project `forge-personal-biswas07`, as the Production Secret `BETTER_AUTH_API_KEY`. Preserve this server setting during subsequent deployments. Do not restore an older value from chat or copy a value into source, logs, evidence or model context. The reporting task did not regenerate/rotate the credential or purchase a plan.

The existing application already conditionally enables the `dash` plugin from `@better-auth/infra` when that private environment variable is present. This handoff makes no dependency or source change.

## Reported redeployment

- Deployment: `dpl_D7U4BwMECfeeL1tTQ7P8gmXNGYku`, reported Ready.
- Immutable URL: <https://forge-personal-biswas07-qaqxtigby-biswas07.vercel.app>.
- Alias: <https://forge-personal-biswas07.vercel.app>.
- The prior deployed source was redeployed. This does **not** deploy the newer source/admission commit `c4fda6790a101f1ae2fa2cc9af2f3c7119a36395`.
- No migrations, engine activation or original public availability promotion were performed.

The integration task independently fetched the alias `/login` and received HTTP 200. That HTTP check does not verify the rendered login state, dashboard plan, deployment/source identity or successful authentication; those details above are attributed to the setup task.

## Outstanding verification

The setup task still observes invitation-required/provider-configuration copy on the hosted login. Google/GitHub OAuth, public signup and actual verification/recovery delivery remain unverified. Dashboard observations of installed Better Auth `1.7.3`, infrastructure plugin `0.4.8`, available upgrades and unconfigured IP address headers are follow-up findings, not authorization to upgrade dependencies or trust arbitrary forwarded headers.

The existing full A–P ledger remains open. Infrastructure dashboard connectivity does not supply model credentials, connect the hosted worker, build a generated website, authorize private application data or publish an application. Keep PR18 draft and preserve the existing deployment/enrollment/worker restrictions.
