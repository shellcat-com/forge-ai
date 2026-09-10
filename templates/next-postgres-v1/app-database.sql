-- PLATFORM-OWNED BOOTSTRAP, run by the guest supervisor against the disposable
-- app database ONLY. Never an engine/control migration. Secrets are supplied by
-- guest-private credential provisioning; roles cannot log in until that step.
REVOKE ALL ON DATABASE forge_app FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE ROLE forge_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1;
CREATE ROLE forge_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 5;
GRANT CONNECT ON DATABASE forge_app TO forge_migrator, forge_app;
CREATE SCHEMA app AUTHORIZATION forge_migrator;
GRANT USAGE ON SCHEMA app TO forge_app;
ALTER DEFAULT PRIVILEGES FOR ROLE forge_migrator IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO forge_app;
ALTER DEFAULT PRIVILEGES FOR ROLE forge_migrator IN SCHEMA app GRANT USAGE, SELECT ON SEQUENCES TO forge_app;
ALTER ROLE forge_migrator SET search_path = app, pg_catalog;
ALTER ROLE forge_migrator SET statement_timeout = '15s';
ALTER ROLE forge_migrator SET lock_timeout = '3s';
ALTER ROLE forge_migrator SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE forge_app SET search_path = app, pg_catalog;
ALTER ROLE forge_app SET statement_timeout = '5s';
ALTER ROLE forge_app SET idle_in_transaction_session_timeout = '5s';
ALTER ROLE forge_app SET work_mem = '4MB';
ALTER ROLE forge_migrator SET work_mem = '4MB';
