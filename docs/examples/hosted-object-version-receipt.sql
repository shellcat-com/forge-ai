-- Additive registration for the already installed object-schema migration.
-- The installer first verifies the immutable 0006 SQL hash; never rewrite it.
BEGIN;
DO $$ BEGIN
 IF to_regclass('forge_objects.capacity') IS NULL
  OR NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='forge_objects' AND c.relname='versions' AND c.relrowsecurity AND c.relforcerowsecurity)
  OR to_regprocedure('forge_objects.adopt(text,uuid,uuid,uuid)') IS NULL
  OR to_regprocedure('forge_objects.retire(text,uuid)') IS NULL
  OR to_regprocedure('forge_objects.purge(text,uuid)') IS NULL
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='forge_objects.versions'::regclass
    AND tgname='release_ciphertext_capacity' AND tgenabled='O')
 THEN RAISE EXCEPTION 'encrypted object schema registration unavailable'; END IF;
END $$;
INSERT INTO forge_control.schema_migrations(version) VALUES(6) ON CONFLICT(version) DO NOTHING;
COMMIT;
