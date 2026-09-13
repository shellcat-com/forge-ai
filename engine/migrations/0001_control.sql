-- E0 control schema only. PostgreSQL 14+ SQL baseline; no app database, roles,
-- credentials, extensions, runner or public endpoint is provisioned here.
BEGIN;
CREATE SCHEMA forge_control;
REVOKE ALL ON SCHEMA forge_control FROM PUBLIC;
SET LOCAL search_path = forge_control, pg_catalog;
CREATE DOMAIN sha256_hex AS text CHECK (VALUE ~ '^[a-f0-9]{64}$');
CREATE DOMAIN safe_uint AS bigint CHECK (VALUE BETWEEN 0 AND 9007199254740991);
CREATE DOMAIN job_state AS text CHECK (VALUE IN ('QUEUED','PLANNING','AWAITING_PLAN_APPROVAL','GENERATING','VALIDATING','AWAITING_EXECUTION_APPROVAL','PROVISIONING','VERIFYING','REPAIRING','PREPARING_PREVIEW','AWAITING_PROMOTION','CANCELLING','SUCCEEDED','FAILED','CANCELLED','EXPIRED'));
CREATE FUNCTION json_v1(value jsonb, cap integer) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT jsonb_typeof(value) = 'object' AND value->'schemaVersion' = '1'::jsonb AND octet_length(value::text) <= cap
$$;
CREATE TABLE schema_migrations (version integer PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO schema_migrations(version) VALUES (1);
CREATE TABLE users (
 id uuid PRIMARY KEY, oidc_issuer text NOT NULL CHECK(length(oidc_issuer) BETWEEN 1 AND 2048),
 oidc_subject text NOT NULL CHECK(length(oidc_subject) BETWEEN 1 AND 255), disabled_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(oidc_issuer,oidc_subject)
);
CREATE TABLE workspaces (
 id uuid PRIMARY KEY, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 disabled_at timestamptz, deleting_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
 workspace_id uuid NOT NULL REFERENCES workspaces(id), user_id uuid NOT NULL REFERENCES users(id),
 role text NOT NULL CHECK(role IN ('owner','editor','viewer')), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,user_id)
);
CREATE TABLE sessions (
 id_hash sha256_hex PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), csrf_hash sha256_hex NOT NULL,
 expires_at timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), CHECK(expires_at > created_at AND expires_at <= created_at + interval '12 hours')
);
CREATE TABLE auth_transactions (
 id_hash sha256_hex PRIMARY KEY, state_hash sha256_hex NOT NULL UNIQUE, nonce_hash sha256_hex NOT NULL,
 encrypted_pkce_verifier text NOT NULL CHECK(length(encrypted_pkce_verifier) BETWEEN 1 AND 4096),
 return_path text NOT NULL CHECK(return_path ~ '^/[^/]*' AND return_path !~ '[\\\r\n]' AND return_path !~ '^//'),
 expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(expires_at > created_at AND expires_at <= created_at + interval '10 minutes')
);
CREATE TABLE projects (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 brief text NOT NULL CHECK(length(brief) BETWEEN 20 AND 12000), preset_id text NOT NULL, preset_version integer NOT NULL CHECK(preset_version > 0),
 template_id text NOT NULL CHECK(template_id = 'next-postgres-v1'), template_digest sha256_hex NOT NULL,
 head_snapshot_id uuid, revision safe_uint NOT NULL DEFAULT 1 CHECK(revision >= 1), deleting_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id)
);
CREATE TABLE jobs (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, project_id uuid NOT NULL, created_by uuid NOT NULL REFERENCES users(id),
 kind text NOT NULL CHECK(kind IN ('generate','restore')), base_snapshot_id uuid, base_revision safe_uint NOT NULL CHECK(base_revision >= 1),
 request_json jsonb NOT NULL CHECK(json_v1(request_json,65536) IS TRUE), state job_state NOT NULL DEFAULT 'QUEUED',
 state_version safe_uint NOT NULL DEFAULT 1 CHECK(state_version >= 1), policy_digest sha256_hex NOT NULL, template_digest sha256_hex NOT NULL,
 prompt_version text NOT NULL, model_policy_json jsonb NOT NULL CHECK(json_v1(model_policy_json,8192) IS TRUE),
 plan_artifact_id uuid, candidate_snapshot_id uuid, repair_count integer NOT NULL DEFAULT 0 CHECK(repair_count BETWEEN 0 AND 2),
 cost_limit_micros safe_uint NOT NULL, active_remaining_ms integer NOT NULL CHECK(active_remaining_ms BETWEEN 0 AND 1200000),
 active_started_at timestamptz, active_deadline_at timestamptz, review_expires_at timestamptz, review_digest sha256_hex,
 review_json jsonb CHECK(review_json IS NULL OR json_v1(review_json,65536) IS TRUE),
 cancel_requested_at timestamptz, error_code text, next_event_seq safe_uint NOT NULL DEFAULT 1 CHECK(next_event_seq >= 1),
 finished_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,project_id,id),
 FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),
 CHECK((state IN ('SUCCEEDED','FAILED','CANCELLED','EXPIRED')) = (finished_at IS NOT NULL)),
 CHECK((state IN ('AWAITING_PLAN_APPROVAL','AWAITING_EXECUTION_APPROVAL','AWAITING_PROMOTION')) = (review_expires_at IS NOT NULL)),
 CHECK((review_digest IS NULL) = (review_expires_at IS NULL)),
 CHECK((review_digest IS NULL) = (review_json IS NULL)),
 CHECK((active_started_at IS NULL) = (active_deadline_at IS NULL)),
 CHECK(active_deadline_at IS NULL OR (active_deadline_at > active_started_at AND active_deadline_at <= active_started_at + active_remaining_ms * interval '1 millisecond')),
 CHECK(review_expires_at IS NULL OR review_expires_at <= created_at + interval '7 days'),
 CHECK(kind <> 'restore' OR (base_snapshot_id IS NOT NULL AND repair_count = 0)),
 CHECK(state <> 'CANCELLING' OR cancel_requested_at IS NOT NULL)
);
CREATE UNIQUE INDEX jobs_one_unfinished ON jobs(workspace_id,project_id) WHERE finished_at IS NULL;
CREATE TABLE artifacts (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, project_id uuid NOT NULL, job_id uuid,
 kind text NOT NULL CHECK(kind IN ('plan','source-manifest','source-blob','diff','verification','log','screenshot','source-export','build-output')),
 object_key text NOT NULL CHECK(length(object_key) BETWEEN 1 AND 1024 AND object_key !~ '://'), object_version text NOT NULL CHECK(length(object_version) BETWEEN 1 AND 255),
 sha256 sha256_hex NOT NULL, bytes safe_uint NOT NULL CHECK(bytes <= 1073741824),
 status text NOT NULL CHECK(status IN ('quarantine','available','rejected')), expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,project_id,id), UNIQUE(object_key,object_version),
 FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),
 FOREIGN KEY(workspace_id,project_id,job_id) REFERENCES jobs(workspace_id,project_id,id)
);
CREATE TABLE snapshots (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, project_id uuid NOT NULL, job_id uuid NOT NULL, parent_id uuid,
 manifest_artifact_id uuid NOT NULL, manifest_digest sha256_hex NOT NULL, template_digest sha256_hex NOT NULL, schema_digest sha256_hex NOT NULL,
 verification_artifact_id uuid, status text NOT NULL CHECK(status IN ('candidate','verified','rejected')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,project_id,id), UNIQUE(workspace_id,project_id,job_id,id),
 FOREIGN KEY(workspace_id,project_id,job_id) REFERENCES jobs(workspace_id,project_id,id),
 FOREIGN KEY(workspace_id,project_id,parent_id) REFERENCES snapshots(workspace_id,project_id,id),
 FOREIGN KEY(workspace_id,project_id,manifest_artifact_id) REFERENCES artifacts(workspace_id,project_id,id),
 FOREIGN KEY(workspace_id,project_id,verification_artifact_id) REFERENCES artifacts(workspace_id,project_id,id),
 CHECK((status = 'verified') = (verification_artifact_id IS NOT NULL))
);
ALTER TABLE projects ADD FOREIGN KEY(workspace_id,id,head_snapshot_id) REFERENCES snapshots(workspace_id,project_id,id) DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE jobs ADD FOREIGN KEY(workspace_id,project_id,base_snapshot_id) REFERENCES snapshots(workspace_id,project_id,id);
ALTER TABLE jobs ADD FOREIGN KEY(workspace_id,project_id,id,candidate_snapshot_id) REFERENCES snapshots(workspace_id,project_id,job_id,id);
ALTER TABLE jobs ADD FOREIGN KEY(workspace_id,project_id,plan_artifact_id) REFERENCES artifacts(workspace_id,project_id,id);
CREATE TABLE job_steps (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, project_id uuid NOT NULL, job_id uuid NOT NULL,
 stage job_state NOT NULL, attempt integer NOT NULL CHECK(attempt BETWEEN 1 AND 12), status text NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
 available_at timestamptz NOT NULL, lease_owner uuid, lease_epoch safe_uint NOT NULL DEFAULT 0, lease_expires_at timestamptz,
 input_digest sha256_hex NOT NULL, output_artifact_id uuid, external_operation_id uuid, started_at timestamptz, finished_at timestamptz, error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(job_id,stage,attempt), UNIQUE(workspace_id,project_id,job_id,id),
 FOREIGN KEY(workspace_id,project_id,job_id) REFERENCES jobs(workspace_id,project_id,id),
 FOREIGN KEY(workspace_id,project_id,output_artifact_id) REFERENCES artifacts(workspace_id,project_id,id),
 CHECK((status = 'running') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
 CHECK((lease_owner IS NULL) = (lease_expires_at IS NULL)), CHECK(status <> 'running' OR lease_epoch > 0),
 CHECK((status IN ('succeeded','failed','cancelled')) = (finished_at IS NOT NULL))
);
CREATE TABLE job_events (
 workspace_id uuid NOT NULL, project_id uuid NOT NULL, job_id uuid NOT NULL, seq safe_uint NOT NULL CHECK(seq >= 1),
 type text NOT NULL CHECK(type IN ('job.state','plan.ready','changes.ready','approval.recorded','step.started','step.finished','check.result','usage.updated','preview.state','job.terminal')),
 schema_version integer NOT NULL CHECK(schema_version = 1), state_version safe_uint NOT NULL CHECK(state_version >= 1),
 payload_json jsonb NOT NULL CHECK(json_v1(payload_json,8192) IS TRUE), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(job_id,seq), FOREIGN KEY(workspace_id,project_id,job_id) REFERENCES jobs(workspace_id,project_id,id),
 CHECK((payload_json->>'workspaceId'=workspace_id::text AND payload_json->>'projectId'=project_id::text
 AND payload_json->>'jobId'=job_id::text AND payload_json->>'type'=type
 AND payload_json->'seq'=to_jsonb(seq) AND payload_json->'stateVersion'=to_jsonb(state_version)
 AND jsonb_typeof(payload_json->'data')='object') IS TRUE)
);
CREATE TABLE approvals (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, project_id uuid NOT NULL, job_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id), kind text NOT NULL CHECK(kind IN ('plan','execution','promotion')),
 subject_digest sha256_hex NOT NULL, state_version safe_uint NOT NULL CHECK(state_version >= 1), decision text NOT NULL CHECK(decision IN ('approve','reject')),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(job_id,kind,subject_digest,actor_id,state_version), FOREIGN KEY(workspace_id,project_id,job_id) REFERENCES jobs(workspace_id,project_id,id),
 CHECK(expires_at > created_at AND expires_at <= created_at + interval '24 hours')
);
CREATE TABLE environments (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, project_id uuid NOT NULL, job_id uuid NOT NULL, snapshot_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('test','preview')), broker_operation_id uuid NOT NULL UNIQUE, lease_epoch safe_uint NOT NULL CHECK(lease_epoch > 0),
 state text NOT NULL CHECK(state IN ('requested','starting','ready','stopping','destroyed','quarantined','failed')),
 expires_at timestamptz NOT NULL, last_heartbeat_at timestamptz, destroyed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,project_id,id), UNIQUE(workspace_id,project_id,snapshot_id,id),
 FOREIGN KEY(workspace_id,project_id,job_id) REFERENCES jobs(workspace_id,project_id,id),
 FOREIGN KEY(workspace_id,project_id,job_id,snapshot_id) REFERENCES snapshots(workspace_id,project_id,job_id,id),
 CHECK((state = 'destroyed') = (destroyed_at IS NOT NULL))
);
CREATE TABLE app_databases (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, project_id uuid NOT NULL, environment_id uuid NOT NULL UNIQUE,
 volume_ref uuid NOT NULL, schema_digest sha256_hex NOT NULL, runtime_secret_ref uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('requested','ready','deleting','deleted','failed')), expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(workspace_id,project_id,environment_id) REFERENCES environments(workspace_id,project_id,id)
);
CREATE TABLE previews (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, project_id uuid NOT NULL, snapshot_id uuid NOT NULL, environment_id uuid NOT NULL UNIQUE,
 generation uuid NOT NULL UNIQUE, state text NOT NULL CHECK(state IN ('REQUESTED','STARTING','READY','STOPPING','STOPPED','FAILED','EXPIRING','EXPIRED')),
 absolute_expires_at timestamptz NOT NULL, idle_expires_at timestamptz NOT NULL, last_user_activity_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,project_id,id),
 FOREIGN KEY(workspace_id,project_id,snapshot_id,environment_id) REFERENCES environments(workspace_id,project_id,snapshot_id,id),
 CHECK(idle_expires_at <= absolute_expires_at AND absolute_expires_at > created_at AND absolute_expires_at <= created_at + interval '2 hours')
);
CREATE UNIQUE INDEX previews_one_ready ON previews(workspace_id,project_id) WHERE state = 'READY';
CREATE TABLE preview_tickets (
 token_hash sha256_hex PRIMARY KEY, workspace_id uuid NOT NULL, project_id uuid NOT NULL, preview_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id),
 purpose text NOT NULL CHECK(purpose IN ('launch','session')), expires_at timestamptz NOT NULL, consumed_at timestamptz, revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(workspace_id,project_id,preview_id) REFERENCES previews(workspace_id,project_id,id),
 CHECK(expires_at > created_at AND (purpose <> 'launch' OR expires_at <= created_at + interval '60 seconds'))
);
CREATE TABLE usage_reservations (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, project_id uuid NOT NULL, job_id uuid NOT NULL UNIQUE,
 reserved_micros safe_uint NOT NULL, settled_micros safe_uint NOT NULL DEFAULT 0,
 status text NOT NULL CHECK(status IN ('open','settled','uncertain')), expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(workspace_id,project_id,job_id) REFERENCES jobs(workspace_id,project_id,id),
 CHECK(settled_micros <= reserved_micros)
);
CREATE TABLE usage_ledger (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, project_id uuid NOT NULL, job_id uuid NOT NULL, step_id uuid NOT NULL,
 provider_request_id text, input_tokens safe_uint, output_tokens safe_uint, amount_micros bigint NOT NULL,
 price_version text NOT NULL, classification text NOT NULL CHECK(classification IN ('measured','estimated','adjustment')), dedupe_key text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(workspace_id,project_id,job_id,step_id) REFERENCES job_steps(workspace_id,project_id,job_id,id),
 CHECK(amount_micros BETWEEN -9007199254740991 AND 9007199254740991 AND (classification = 'adjustment' OR amount_micros >= 0))
);
CREATE TABLE workspace_quotas (
 workspace_id uuid NOT NULL REFERENCES workspaces(id), period_start timestamptz NOT NULL,
 limit_micros safe_uint NOT NULL, reserved_micros safe_uint NOT NULL DEFAULT 0, spent_micros safe_uint NOT NULL DEFAULT 0,
 max_active_jobs integer NOT NULL CHECK(max_active_jobs BETWEEN 1 AND 100), max_previews integer NOT NULL CHECK(max_previews BETWEEN 0 AND 100),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,period_start), CHECK(reserved_micros + spent_micros <= limit_micros)
);
CREATE TABLE idempotency_records (
 workspace_id uuid NOT NULL REFERENCES workspaces(id), actor_id uuid NOT NULL REFERENCES users(id), route text NOT NULL CHECK(length(route) BETWEEN 1 AND 240),
 key text NOT NULL CHECK(key ~ '^[!-~]{16,128}$'), request_digest sha256_hex NOT NULL,
 response_status integer NOT NULL CHECK(response_status BETWEEN 200 AND 599), response_json jsonb NOT NULL CHECK(json_v1(response_json,65536) IS TRUE),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,actor_id,route,key)
);
CREATE TABLE audit_events (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), actor_kind text NOT NULL CHECK(actor_kind IN ('user','service')),
 actor_id uuid NOT NULL, action text NOT NULL CHECK(length(action) BETWEEN 1 AND 120), resource_id uuid NOT NULL, request_id uuid NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('allowed','denied','failed')), metadata_json jsonb NOT NULL CHECK(json_v1(metadata_json,8192) IS TRUE),
 created_at timestamptz NOT NULL DEFAULT now()
);
-- Append-only records cannot be silently erased by application DML or cascades.
CREATE FUNCTION deny_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'append-only record' USING ERRCODE='23514'; END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['approvals','job_events','usage_ledger','audit_events','schema_migrations'] LOOP
  EXECUTE format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION deny_mutation()',t);
 END LOOP;
END $$;
CREATE FUNCTION protect_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (to_jsonb(NEW) - 'status' - 'verification_artifact_id') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'verification_artifact_id')
 OR OLD.status <> 'candidate' OR NEW.status NOT IN ('verified','rejected') THEN
  RAISE EXCEPTION 'immutable snapshot content or invalid status transition' USING ERRCODE='23514';
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER snapshot_content BEFORE UPDATE ON snapshots FOR EACH ROW EXECUTE FUNCTION protect_snapshot();
CREATE FUNCTION protect_artifact() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (to_jsonb(NEW) - 'status' - 'expires_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'expires_at')
 OR (OLD.status <> NEW.status AND (OLD.status <> 'quarantine' OR NEW.status NOT IN ('available','rejected'))) THEN
  RAISE EXCEPTION 'immutable artifact' USING ERRCODE='23514';
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER artifact_content BEFORE UPDATE ON artifacts FOR EACH ROW EXECUTE FUNCTION protect_artifact();
CREATE FUNCTION check_snapshot_artifacts() RETURNS trigger LANGUAGE plpgsql SET search_path=forge_control,pg_catalog AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM artifacts WHERE workspace_id=NEW.workspace_id AND project_id=NEW.project_id
 AND id=NEW.manifest_artifact_id AND kind='source-manifest' AND status='available' AND sha256=NEW.manifest_digest) THEN
  RAISE EXCEPTION 'snapshot requires available matching source manifest' USING ERRCODE='23514';
 END IF;
 IF NEW.status='verified' AND NOT EXISTS(SELECT 1 FROM artifacts WHERE workspace_id=NEW.workspace_id AND project_id=NEW.project_id
 AND job_id=NEW.job_id AND id=NEW.verification_artifact_id AND kind='verification' AND status='available') THEN
  RAISE EXCEPTION 'verified snapshot requires available job verification artifact' USING ERRCODE='23514';
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER snapshot_artifact_binding BEFORE INSERT OR UPDATE ON snapshots FOR EACH ROW EXECUTE FUNCTION check_snapshot_artifacts();
CREATE FUNCTION check_project_head() RETURNS trigger LANGUAGE plpgsql SET search_path=forge_control,pg_catalog AS $$
DECLARE snapshot_status text; BEGIN
 IF NEW.head_snapshot_id IS DISTINCT FROM OLD.head_snapshot_id THEN
  SELECT status INTO snapshot_status FROM snapshots WHERE workspace_id=NEW.workspace_id AND project_id=NEW.id AND id=NEW.head_snapshot_id;
  IF snapshot_status IS NULL THEN RAISE EXCEPTION 'head outside project or missing' USING ERRCODE='23503'; END IF;
  IF snapshot_status <> 'verified' OR NEW.revision <> OLD.revision + 1 THEN
   RAISE EXCEPTION 'head requires verified snapshot and revision CAS increment' USING ERRCODE='23514';
  END IF;
 END IF;
 IF NEW.revision < OLD.revision THEN RAISE EXCEPTION 'revision cannot decrease' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER project_head_binding BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION check_project_head();
CREATE FUNCTION check_job_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed boolean; BEGIN
 IF ROW(NEW.id,NEW.workspace_id,NEW.project_id,NEW.created_by,NEW.kind,NEW.base_snapshot_id,NEW.base_revision,
 NEW.request_json,NEW.policy_digest,NEW.template_digest,NEW.prompt_version,NEW.model_policy_json,NEW.cost_limit_micros,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.workspace_id,OLD.project_id,OLD.created_by,OLD.kind,OLD.base_snapshot_id,OLD.base_revision,
 OLD.request_json,OLD.policy_digest,OLD.template_digest,OLD.prompt_version,OLD.model_policy_json,OLD.cost_limit_micros,OLD.created_at) THEN
  RAISE EXCEPTION 'immutable admitted job contract' USING ERRCODE='23514';
 END IF;
 IF OLD.state IN ('SUCCEEDED','FAILED','CANCELLED','EXPIRED') THEN
  RAISE EXCEPTION 'terminal job is immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.repair_count < OLD.repair_count OR NEW.active_remaining_ms > OLD.active_remaining_ms
 OR NEW.next_event_seq < OLD.next_event_seq OR (OLD.cancel_requested_at IS NOT NULL AND NEW.cancel_requested_at IS NULL) THEN
  RAISE EXCEPTION 'non-monotonic job metadata' USING ERRCODE='23514';
 END IF;
 IF NEW.state = OLD.state THEN
  IF NEW.state_version <> OLD.state_version OR NEW.repair_count <> OLD.repair_count
  OR NEW.review_digest IS DISTINCT FROM OLD.review_digest OR NEW.review_json IS DISTINCT FROM OLD.review_json
  OR NEW.review_expires_at IS DISTINCT FROM OLD.review_expires_at THEN
   RAISE EXCEPTION 'version/review change without transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 allowed := CASE OLD.state
 WHEN 'QUEUED' THEN NEW.state = CASE OLD.kind WHEN 'generate' THEN 'PLANNING' ELSE 'VALIDATING' END
 WHEN 'PLANNING' THEN NEW.state = 'AWAITING_PLAN_APPROVAL'
 WHEN 'AWAITING_PLAN_APPROVAL' THEN NEW.state = 'GENERATING'
 WHEN 'GENERATING' THEN NEW.state = 'VALIDATING'
 WHEN 'VALIDATING' THEN NEW.state IN ('AWAITING_EXECUTION_APPROVAL','REPAIRING')
 WHEN 'AWAITING_EXECUTION_APPROVAL' THEN NEW.state = 'PROVISIONING'
 WHEN 'PROVISIONING' THEN NEW.state = 'VERIFYING'
 WHEN 'VERIFYING' THEN NEW.state IN ('PREPARING_PREVIEW','REPAIRING')
 WHEN 'REPAIRING' THEN NEW.state = 'VALIDATING'
 WHEN 'PREPARING_PREVIEW' THEN NEW.state = 'AWAITING_PROMOTION'
 WHEN 'AWAITING_PROMOTION' THEN NEW.state = 'SUCCEEDED'
 WHEN 'CANCELLING' THEN NEW.state = 'CANCELLED' ELSE false END;
 IF OLD.state <> 'CANCELLING' AND NEW.state IN ('CANCELLING','FAILED','EXPIRED') THEN allowed := true; END IF;
 IF NOT allowed OR NEW.state_version <> OLD.state_version + 1 OR (NEW.state = 'REPAIRING' AND (OLD.kind='restore' OR NEW.repair_count <> OLD.repair_count + 1))
 OR (NEW.state <> 'REPAIRING' AND NEW.repair_count <> OLD.repair_count)
 OR (OLD.cancel_requested_at IS NOT NULL AND NEW.state NOT IN ('CANCELLING','CANCELLED','FAILED','EXPIRED')) THEN
  RAISE EXCEPTION 'forbidden job transition' USING ERRCODE='23514';
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER job_transition BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION check_job_transition();
-- Defense in depth only: the future authenticated API sets this transaction-local
-- workspace after authorization. No service is granted access by this migration.
DO $$ DECLARE t text; BEGIN
 FOR t IN SELECT table_name FROM information_schema.columns WHERE table_schema='forge_control' AND column_name='workspace_id' LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING (workspace_id = nullif(current_setting(''forge.workspace_id'',true),'''')::uuid) WITH CHECK (workspace_id = nullif(current_setting(''forge.workspace_id'',true),'''')::uuid)',t);
 END LOOP;
END $$;
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON workspaces USING(id = nullif(current_setting('forge.workspace_id',true),'')::uuid) WITH CHECK(id = nullif(current_setting('forge.workspace_id',true),'')::uuid);
-- Index every referencing FK for tenant lookup and cleanup (including nullable refs).
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT c.conrelid::regclass AS tab,c.conname,
 string_agg(quote_ident(a.attname),',' ORDER BY u.ord) AS cols
 FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY u(attnum,ord)
 JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=u.attnum
 WHERE c.contype='f' AND c.connamespace='forge_control'::regnamespace GROUP BY c.conrelid,c.conname LOOP
  EXECUTE format('CREATE INDEX ON %s (%s)',r.tab,r.cols);
 END LOOP;
END $$;
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX auth_transactions_expiry ON auth_transactions(expires_at);
CREATE INDEX steps_queue ON job_steps(status,available_at) WHERE status='queued';
CREATE INDEX steps_lease ON job_steps(lease_expires_at) WHERE status='running';
CREATE INDEX environments_cleanup ON environments(state,expires_at);
CREATE INDEX artifacts_expiry ON artifacts(expires_at);
CREATE INDEX preview_tickets_expiry ON preview_tickets(expires_at);
CREATE INDEX reservations_expiry ON usage_reservations(status,expires_at);
CREATE INDEX idempotency_expiry ON idempotency_records(expires_at);
CREATE INDEX audit_workspace_time ON audit_events(workspace_id,created_at);
REVOKE ALL ON ALL TABLES IN SCHEMA forge_control FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA forge_control FROM PUBLIC;
COMMIT;
