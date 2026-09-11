-- Operator review script for a DEDICATED Forge database, after app migrations.
-- No passwords or runtime LOGINs are created here. Bind an independently created
-- private login to forge_auth_api through your infrastructure secret manager.
-- Inspect public schema users before applying: revoking PUBLIC CREATE affects
-- all database users. Do not run against a shared/unrelated application database.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='forge_auth_api') THEN
    CREATE ROLE forge_auth_api NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='forge_auth_api' AND
    (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole)) THEN
    RAISE EXCEPTION 'Unsafe existing auth role';
  END IF;
END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO forge_auth_api;
GRANT SELECT,INSERT,UPDATE,DELETE ON forge_user,forge_session,forge_account,
  forge_verification,forge_beta_invites,forge_auth_admission TO forge_auth_api;
COMMIT;
