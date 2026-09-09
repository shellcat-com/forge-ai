# Cloud setup status — September 9, 2026

This is a sanitized execution record. It contains no passwords, connection strings, API keys or customer records.

## Neon

Inspected the logged-in Brave console in organization `org-solitary-bonus-96047632`. The existing project is `curly-heart-88402811`, PostgreSQL 18, AWS Ohio, with production branch `br-polished-glade-a59tsy89`. Its displayed storage was 32.1 MB. The database has not been established as empty, backed up, transferred or deleted.

Opened New project and inspected the region selector. The account offered AWS US East 1, US East 2, US West 2, Singapore, Sydney, Frankfurt, London and São Paulo. There was no Azure choice. Cancelled the unsubmitted form. No replacement was created; no purchase or upgrade was made.

Required replacement remains `forge-ai`, Azure East US 2 preferred, PostgreSQL 17, database `forge`, production/development branches, separate migration/application roles, pooled application and direct migration connections. Do not substitute AWS. Azure availability in this account is an external prerequisite.

The old project must remain until its data/dependencies are inspected, recoverable private backup is verified where needed, PostgreSQL 18→17 compatibility is checked, the replacement passes migrations and application read/write/authentication checks, and active configuration has moved. Deletion authorization for exactly the named old project remains valid.

## Better Auth

Inspected the logged-in onboarding flow and selected Connect existing project. The connection form requires a publicly reachable application URL. It offers localhost tunnelling guidance. No tunnel, public service or dashboard project was activated. No old Better Auth project was identified for deletion.

The local implementation pins Better Auth 1.7.3, its Drizzle adapter 1.7.3, and infrastructure integration 0.4.8. The Next.js auth route and PostgreSQL tables exist. The server conditionally enables the dashboard integration when its private API key is configured. OAuth and transactional email remain disabled unless their server configuration exists.

The local authentication integration test passed invite gating, email verification, sign-in, persisted session and sign-out. Email delivery was stubbed in that test. This does not verify a live sender, OAuth application, dashboard connection or production environment.

Create and verify separate `Forge AI Development` and `Forge AI Production` connections after the respective reachable servers exist. Neon stores identity data; Forge runs Better Auth. No second Neon Auth system is introduced.

## Local preparation completed

Created a separate local `forge_unified` PostgreSQL database. Applied additive migrations 0001–0003. Original engine database remains intact. Private local configuration is ignored by Git. Imported the two existing engine projects with 12 revisions and verified their source content. Project, job and revision IDs were preserved; event cursors were allocated in the destination database. Runtime handles were not copied.

Hosted generation remains explicitly disabled pending isolated sandbox and monetary-budget verification. No production release is claimed.
