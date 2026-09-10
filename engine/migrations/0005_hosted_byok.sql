-- Published integration of the preserved Task04 proposal. Does not enable dispatch.
BEGIN;
SET LOCAL search_path=forge_control,pg_catalog;
ALTER TABLE provider_attempts DROP CONSTRAINT provider_attempts_job_id_step_id_key;
ALTER TABLE provider_attempts DROP CONSTRAINT provider_attempts_state_check;
ALTER TABLE provider_attempts ADD CHECK(state IN ('reserved','dispatched','completed','uncertain','resolved'));
ALTER TABLE provider_attempts ADD COLUMN terms_json jsonb CHECK(terms_json IS NULL OR json_v1(terms_json,8192));
ALTER TABLE provider_attempts ADD COLUMN call_number integer CHECK(call_number BETWEEN 1 AND 12);
ALTER TABLE provider_attempts ADD COLUMN usage_digest sha256_hex;
ALTER TABLE provider_attempts ADD CHECK((terms_json IS NULL) = (call_number IS NULL));
CREATE UNIQUE INDEX provider_legacy_step ON provider_attempts(job_id,step_id) WHERE terms_json IS NULL;
CREATE UNIQUE INDEX provider_call_number ON provider_attempts(job_id,call_number) WHERE call_number IS NOT NULL;
CREATE FUNCTION protect_provider_terms() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (to_jsonb(NEW)-'state'-'amount_micros'-'usage_digest') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'amount_micros'-'usage_digest') THEN
   RAISE EXCEPTION 'immutable provider call' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER provider_terms_immutable BEFORE UPDATE ON provider_attempts FOR EACH ROW EXECUTE FUNCTION protect_provider_terms();
-- Existing forced tenant RLS and E1 worker role grants cover the new columns.
-- Credentials are a separate namespace from source/artifact objects and never
-- joined into source exports. Task05 auth transaction fences owner+CSRF+revocation.
CREATE TABLE provider_credentials (
 workspace_id uuid NOT NULL REFERENCES workspaces(id), id uuid NOT NULL, revision safe_uint NOT NULL CHECK(revision>0),
 provider text NOT NULL, destination text NOT NULL, envelope_json jsonb, deleted boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(workspace_id,id),
 CHECK(deleted = (envelope_json IS NULL)), CHECK(envelope_json IS NULL OR octet_length(envelope_json::text)<=20000)
);
ALTER TABLE provider_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY credential_scope ON provider_credentials USING(workspace_id::text=current_setting('forge.workspace_id',true))
 WITH CHECK(workspace_id::text=current_setting('forge.workspace_id',true));
GRANT SELECT,INSERT,UPDATE ON provider_credentials TO forge_control_api;
GRANT SELECT ON provider_credentials TO forge_control_worker;
-- REQUIRED BEFORE INTEGRATION: Task01's dispatch gate must lock/check global job
-- envelope, current project/job/step/lease and cleanup, approved price/model-policy,
-- current credential revision/deleted state, owner membership, kill switches and
-- admission budget. Allocate whole job maximum under global+workspace caps.
-- releaseReservation/reconciler must retain 'reserved' as well as dispatched and
-- uncertain maxima, and update global liabilities on settlement/release. A crash
-- after dispatch CAS cannot cause automatic redispatch. Late settlement can use
-- the persisted receipt without granting source adoption or a fresh provider call.
CREATE FUNCTION protect_credential_binding() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.workspace_id<>OLD.workspace_id OR NEW.id<>OLD.id OR NEW.provider<>OLD.provider OR NEW.destination<>OLD.destination
 OR OLD.deleted OR NEW.revision<>OLD.revision+1 THEN
   RAISE EXCEPTION 'immutable credential binding' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER credential_binding_immutable BEFORE UPDATE ON provider_credentials FOR EACH ROW EXECUTE FUNCTION protect_credential_binding();

CREATE TABLE provider_validations (
 workspace_id uuid NOT NULL, credential_id uuid NOT NULL, revision safe_uint NOT NULL CHECK(revision>0),
 model text NOT NULL CHECK(length(model) BETWEEN 1 AND 200), free_tier_confirmed boolean NOT NULL CHECK(free_tier_confirmed),
 checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,credential_id),
 FOREIGN KEY(workspace_id,credential_id) REFERENCES provider_credentials(workspace_id,id)
);
CREATE TABLE provider_choices (
 workspace_id uuid PRIMARY KEY REFERENCES workspaces(id), credential_id uuid NOT NULL,
 FOREIGN KEY(workspace_id,credential_id) REFERENCES provider_validations(workspace_id,credential_id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['provider_validations','provider_choices'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING(workspace_id::text=current_setting(''forge.workspace_id'',true)) WITH CHECK(workspace_id::text=current_setting(''forge.workspace_id'',true))',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO forge_control_api',t);
  EXECUTE format('GRANT SELECT ON %I TO forge_control_worker',t);
 END LOOP;
END $$;
CREATE FUNCTION bound_credential_count() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('provider-connections:'||NEW.workspace_id::text,0));
 IF (SELECT count(*) FROM provider_credentials WHERE workspace_id=NEW.workspace_id)>=30
 OR (SELECT count(*) FROM provider_credentials WHERE workspace_id=NEW.workspace_id AND NOT deleted)>=6 THEN
  RAISE EXCEPTION 'CONNECTION_LIMIT' USING ERRCODE='P0429';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER credential_count BEFORE INSERT ON provider_credentials FOR EACH ROW EXECUTE FUNCTION bound_credential_count();
CREATE FUNCTION invalidate_credential_selection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 DELETE FROM provider_choices WHERE workspace_id=NEW.workspace_id AND credential_id=NEW.id;
 DELETE FROM provider_validations WHERE workspace_id=NEW.workspace_id AND credential_id=NEW.id;
 RETURN NEW;
END $$;
CREATE TRIGGER credential_selection_invalidated AFTER UPDATE ON provider_credentials FOR EACH ROW EXECUTE FUNCTION invalidate_credential_selection();
REVOKE ALL ON FUNCTION bound_credential_count(),invalidate_credential_selection() FROM PUBLIC;
INSERT INTO schema_migrations(version) VALUES(5);
COMMIT;
