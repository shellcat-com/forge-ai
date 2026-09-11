-- Dedicated Forge database only. Existing database/public grants are preserved.
BEGIN;
DO $$ BEGIN
 EXECUTE format('GRANT CONNECT ON DATABASE %I TO forge_object_reader,forge_object_writer,forge_object_maintenance',current_database());
END $$;
COMMIT;
