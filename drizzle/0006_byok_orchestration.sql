-- BYOK is an additive application schema. RFC fixture migrations remain separate.
CREATE TABLE forge_connections (
 id uuid PRIMARY KEY, owner_id text NOT NULL, label text NOT NULL, provider text NOT NULL,
 protocol text NOT NULL, base_url text NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
 envelope jsonb, secret_ref text, models jsonb NOT NULL DEFAULT '[]', deleted boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id,id),
 CHECK (NOT deleted OR (envelope IS NULL AND secret_ref IS NULL))
);
CREATE INDEX forge_connections_owner ON forge_connections(owner_id,id) WHERE NOT deleted;
CREATE TABLE forge_routing_profiles (
 owner_id text NOT NULL, scope text NOT NULL, revision integer NOT NULL DEFAULT 1,
 profile jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_id,scope)
);
CREATE TABLE forge_model_runs (
 id uuid PRIMARY KEY, owner_id text NOT NULL, job_id text UNIQUE REFERENCES forge_jobs(id),
 session_id text, snapshot jsonb NOT NULL, status text NOT NULL DEFAULT 'ready', resolved jsonb,
 request_key uuid NOT NULL, request_hash text NOT NULL, calls integer NOT NULL DEFAULT 0 CHECK(calls BETWEEN 0 AND 12),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id,request_key), UNIQUE(owner_id,id)
);
CREATE TABLE forge_model_attempts (
 id uuid PRIMARY KEY, owner_id text NOT NULL, run_id uuid NOT NULL, connection_id uuid NOT NULL,
 credential_revision integer NOT NULL, model_id text NOT NULL, task text NOT NULL, stage_key text NOT NULL,
 request_hash text NOT NULL, status text NOT NULL CHECK(status IN ('dispatched','complete','rejected','unknown')),
 internal_campaign boolean NOT NULL DEFAULT false,
  reserved_micros bigint NOT NULL CHECK(reserved_micros>=0), charged_micros bigint CHECK(charged_micros>=0),
 price jsonb, usage jsonb, result jsonb, error_code text, dispatched_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(owner_id,run_id) REFERENCES forge_model_runs(owner_id,id),
 FOREIGN KEY(owner_id,connection_id) REFERENCES forge_connections(owner_id,id), UNIQUE(run_id,stage_key)
);
CREATE INDEX forge_attempt_owner_time ON forge_model_attempts(owner_id,dispatched_at);
CREATE INDEX forge_attempt_connection_active ON forge_model_attempts(connection_id) WHERE status='dispatched';
-- Every service transaction sets a transaction-local owner. Cross-tenant IDs still
-- require explicit owner predicates; FORCE RLS also protects ordinary runtime roles.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['forge_connections','forge_routing_profiles','forge_model_runs','forge_model_attempts'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY owner_boundary ON %I USING (owner_id=current_setting(''forge.byok_owner'',true)) WITH CHECK (owner_id=current_setting(''forge.byok_owner'',true))',t);
 END LOOP;
END $$;
CREATE TABLE forge_model_budget (
 scope text PRIMARY KEY, liability_micros bigint NOT NULL DEFAULT 0 CHECK(liability_micros>=0)
);
