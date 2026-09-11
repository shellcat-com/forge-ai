-- Hosted source admission/identity and encrypted product metadata. No default
-- allowance/enrollment/admission/worker is enabled by this additive migration.
BEGIN;
SET LOCAL search_path=forge_control,pg_catalog;
ALTER TABLE projects DROP CONSTRAINT projects_origin_check;
ALTER TABLE projects ADD CONSTRAINT projects_origin_check CHECK(origin IN('fixture','hosted'));
ALTER TABLE jobs DROP CONSTRAINT jobs_origin_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_origin_check CHECK(origin IN('fixture','hosted'));
ALTER TABLE snapshots DROP CONSTRAINT snapshots_origin_check;
ALTER TABLE snapshots ADD CONSTRAINT snapshots_origin_check CHECK(origin IN('fixture','hosted'));
ALTER TABLE artifacts DROP CONSTRAINT artifacts_kind_check;
ALTER TABLE artifacts ADD CONSTRAINT artifacts_kind_check CHECK(kind IN('plan','provider-product','source-manifest','source-blob','diff','verification','log','screenshot','source-export','build-output'));

CREATE TABLE hosted_job_bindings (
  workspace_id uuid NOT NULL, project_id uuid NOT NULL, job_id uuid PRIMARY KEY,
  parent_session_hash sha256_hex NOT NULL REFERENCES hosted_sessions(session_hash),
  credential_id uuid NOT NULL, credential_revision safe_uint NOT NULL CHECK(credential_revision>0),
  provider text NOT NULL CHECK(provider IN('gemini','groq','openrouter')),
  model text NOT NULL CHECK(length(model) BETWEEN 1 AND 120),
  provider_policy_json jsonb NOT NULL CHECK(octet_length(provider_policy_json::text)<=8192),
  provider_policy_digest sha256_hex NOT NULL,
  preset_json jsonb NOT NULL CHECK(octet_length(preset_json::text)<=16384),
  instruction_digest sha256_hex NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(workspace_id,project_id,job_id) REFERENCES jobs(workspace_id,project_id,id),
  FOREIGN KEY(workspace_id,credential_id) REFERENCES provider_credentials(workspace_id,id),
  CHECK((provider_policy_json->'price'->>'freeOnly')::boolean IS TRUE),
  CHECK((provider_policy_json->'price'->>'inputMicrosPerMillion'='0') IS TRUE),
  CHECK((provider_policy_json->'price'->>'outputMicrosPerMillion'='0') IS TRUE),
  CHECK((provider_policy_json->>'id'=provider AND provider_policy_json->>'model'=model) IS TRUE)
);
CREATE TABLE hosted_source_products (
  workspace_id uuid NOT NULL, project_id uuid NOT NULL, job_id uuid NOT NULL,
  step_id uuid NOT NULL, operation_id uuid NOT NULL,
  stage text NOT NULL CHECK(stage IN('plan','files','repair')),
  repair_number integer NOT NULL CHECK(repair_number BETWEEN 0 AND 2),
  batch_index integer NOT NULL CHECK(batch_index BETWEEN 0 AND 11),
  artifact_id uuid NOT NULL UNIQUE, request_digest sha256_hex NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(job_id,stage,repair_number,batch_index), UNIQUE(job_id,step_id), UNIQUE(operation_id),
  FOREIGN KEY(workspace_id,project_id,job_id,step_id) REFERENCES job_steps(workspace_id,project_id,job_id,id),
  FOREIGN KEY(workspace_id,project_id,artifact_id) REFERENCES artifacts(workspace_id,project_id,id),
  CHECK((stage='repair')=(repair_number>0)), CHECK(stage<>'plan' OR batch_index=0)
);
CREATE TABLE hosted_generation_limits (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  max_daily_jobs integer NOT NULL CHECK(max_daily_jobs BETWEEN 1 AND 10),
  max_daily_calls integer NOT NULL CHECK(max_daily_calls BETWEEN 1 AND 40),
  max_projects_per_workspace integer NOT NULL CHECK(max_projects_per_workspace BETWEEN 1 AND 5)
);
CREATE TABLE hosted_generation_days (
  day date PRIMARY KEY, jobs integer NOT NULL DEFAULT 0 CHECK(jobs BETWEEN 0 AND 10),
  calls integer NOT NULL DEFAULT 0 CHECK(calls BETWEEN 0 AND 40)
);
CREATE TRIGGER immutable_hosted_job BEFORE UPDATE OR DELETE ON hosted_job_bindings FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER immutable_hosted_product BEFORE UPDATE OR DELETE ON hosted_source_products FOR EACH ROW EXECUTE FUNCTION deny_mutation();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['hosted_job_bindings','hosted_source_products'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING(workspace_id=nullif(current_setting(''forge.workspace_id'',true),'''')::uuid) WITH CHECK(workspace_id=nullif(current_setting(''forge.workspace_id'',true),'''')::uuid)',t);
  EXECUTE format('CREATE POLICY guard_access ON %I TO forge_control_guard USING(true) WITH CHECK(true)',t);
  EXECUTE format('GRANT SELECT ON %I TO forge_control_api,forge_control_worker,forge_control_maintenance,forge_control_guard',t);
 END LOOP;
END $$;
GRANT INSERT ON hosted_job_bindings TO forge_control_api;
GRANT INSERT ON hosted_source_products TO forge_control_worker;
-- PostgreSQL row-share locks require UPDATE on at least one column. The existing
-- immutable binding trigger rejects identity changes and requires a revision
-- increment; this worker has neither revision nor envelope update permission.
GRANT UPDATE(id) ON provider_credentials TO forge_control_worker;
REVOKE ALL ON hosted_generation_limits,hosted_generation_days FROM PUBLIC;
GRANT SELECT ON hosted_generation_limits,hosted_generation_days TO forge_control_api,forge_control_worker,forge_control_maintenance;
GRANT INSERT,UPDATE ON hosted_generation_days TO forge_control_api,forge_control_worker;

-- Resolve only the immutable job binding. Workers cannot present another parent
-- session. Call before project/job locks to retain the API's authority lock order.
CREATE FUNCTION authorize_hosted_job(jid uuid) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=forge_control,pg_catalog AS $$
DECLARE b hosted_job_bindings; j jobs; authorized uuid; BEGIN
 SELECT * INTO b FROM hosted_job_bindings WHERE job_id=jid
  AND workspace_id=nullif(current_setting('forge.workspace_id',true),'')::uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'HOSTED_JOB_UNAVAILABLE' USING ERRCODE='P0404'; END IF;
 SELECT * INTO j FROM jobs WHERE id=jid AND workspace_id=b.workspace_id AND project_id=b.project_id AND origin='hosted';
 IF NOT FOUND THEN RAISE EXCEPTION 'HOSTED_JOB_UNAVAILABLE' USING ERRCODE='P0404'; END IF;
 SELECT user_id INTO authorized FROM authorize_session(b.parent_session_hash,b.workspace_id,'owner');
 IF authorized IS DISTINCT FROM j.created_by THEN RAISE EXCEPTION 'HOSTED_JOB_UNAVAILABLE' USING ERRCODE='P0403'; END IF;
 RETURN authorized;
END $$;
GRANT USAGE,CREATE ON SCHEMA forge_control TO forge_control_guard;
ALTER FUNCTION authorize_hosted_job(uuid) OWNER TO forge_control_guard;
REVOKE CREATE ON SCHEMA forge_control FROM forge_control_guard;
REVOKE ALL ON FUNCTION authorize_hosted_job(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authorize_hosted_job(uuid) TO forge_control_worker,forge_control_maintenance;
INSERT INTO schema_migrations(version) VALUES(9);
COMMIT;
