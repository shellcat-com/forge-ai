-- Dedicated Forge control/auth database only. Preserve unrelated databases.
-- Application database roles must not gain CONNECT or TEMP here through PUBLIC.
BEGIN;
DO $$ BEGIN
 EXECUTE format('REVOKE CONNECT,TEMP ON DATABASE %I FROM PUBLIC',current_database());
 EXECUTE format('GRANT CONNECT ON DATABASE %I TO forge_auth_api,forge_control_api,forge_control_worker,forge_control_maintenance',current_database());
END $$;
COMMIT;
