-- E1 additive migration. Run explicitly as migration owner; never at API startup.
-- Runtime roles have no LOGIN, SUPERUSER or BYPASSRLS. Operators separately bind
-- distinct login identities to exactly one role. E0 migration is unchanged.
BEGIN;
SET LOCAL search_path=forge_control,pg_catalog;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['forge_control_api','forge_control_worker','forge_control_maintenance','forge_control_guard'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOBYPASSRLS',r); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r AND (rolsuper OR rolbypassrls OR rolcanlogin)) THEN RAISE EXCEPTION 'unsafe existing control role'; END IF;
 END LOOP;
END $$;
ALTER TABLE projects ADD COLUMN origin text NOT NULL DEFAULT 'fixture' CHECK(origin='fixture');
ALTER TABLE projects ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE jobs ADD COLUMN origin text NOT NULL DEFAULT 'fixture' CHECK(origin='fixture');
ALTER TABLE jobs ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE jobs ADD COLUMN provider_calls integer NOT NULL DEFAULT 0 CHECK(provider_calls BETWEEN 0 AND 12);
ALTER TABLE jobs ADD COLUMN earliest_event_seq safe_uint NOT NULL DEFAULT 1 CHECK(earliest_event_seq > 0);
ALTER TABLE jobs ADD COLUMN cleanup_target text CHECK(cleanup_target IN ('FAILED','EXPIRED','CANCELLED'));
ALTER TABLE snapshots ADD COLUMN origin text NOT NULL DEFAULT 'fixture' CHECK(origin='fixture');
ALTER TABLE usage_reservations ADD COLUMN period_start timestamptz;
UPDATE usage_reservations SET period_start=date_trunc('day',created_at);
ALTER TABLE usage_reservations ALTER COLUMN period_start SET NOT NULL;
ALTER TABLE usage_reservations ADD FOREIGN KEY(workspace_id,period_start) REFERENCES workspace_quotas(workspace_id,period_start);
CREATE INDEX ON usage_reservations(workspace_id,period_start);
ALTER TABLE usage_reservations ADD COLUMN released_micros safe_uint NOT NULL DEFAULT 0;
ALTER TABLE usage_reservations ADD CHECK(settled_micros + released_micros <= reserved_micros);
ALTER TABLE auth_transactions ADD COLUMN bootstrap_hash sha256_hex;
CREATE TABLE control_settings (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), environment text NOT NULL CHECK(environment='synthetic'),
 admission_enabled boolean NOT NULL DEFAULT false, worker_enabled boolean NOT NULL DEFAULT false,
 security_shutdown boolean NOT NULL DEFAULT false, max_job_micros safe_uint NOT NULL,
 max_queued integer NOT NULL CHECK(max_queued BETWEEN 1 AND 1000), max_running integer NOT NULL CHECK(max_running BETWEEN 1 AND 100),
 max_previews integer NOT NULL DEFAULT 20 CHECK(max_previews BETWEEN 0 AND 1000),
 max_pending_reviews integer NOT NULL DEFAULT 5 CHECK(max_pending_reviews BETWEEN 1 AND 100),
 created_at timestamptz NOT NULL DEFAULT now()
);
-- Deliberately no settings row or enabled flag: explicit synthetic bootstrap required.
CREATE TABLE revoked_policies (digest sha256_hex PRIMARY KEY, reason text NOT NULL CHECK(length(reason)<=120), created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION serialize_revocation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=forge_control,pg_catalog AS $$ BEGIN
 PERFORM singleton FROM control_settings FOR UPDATE; RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER policy_revocation_lock BEFORE INSERT OR UPDATE OR DELETE ON revoked_policies FOR EACH ROW EXECUTE FUNCTION serialize_revocation();
CREATE TABLE job_reviews (
 workspace_id uuid NOT NULL, project_id uuid NOT NULL, job_id uuid NOT NULL, state_version safe_uint NOT NULL,
 kind text NOT NULL CHECK(kind IN ('plan','execution','promotion')), subject_digest sha256_hex NOT NULL,
 body jsonb NOT NULL CHECK(json_v1(body,65536) IS TRUE), expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(job_id,state_version), UNIQUE(workspace_id,project_id,job_id,state_version),
 FOREIGN KEY(workspace_id,project_id,job_id) REFERENCES jobs(workspace_id,project_id,id)
);
CREATE TABLE fixture_artifact_payloads (
 workspace_id uuid NOT NULL, project_id uuid NOT NULL, artifact_id uuid PRIMARY KEY,
 origin text NOT NULL DEFAULT 'fixture' CHECK(origin='fixture'), payload_json jsonb NOT NULL CHECK(octet_length(payload_json::text)<=262144),
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(workspace_id,project_id,artifact_id) REFERENCES artifacts(workspace_id,project_id,id)
);
CREATE TABLE provider_attempts (
 workspace_id uuid NOT NULL, project_id uuid NOT NULL, job_id uuid NOT NULL, step_id uuid NOT NULL,
 operation_id uuid PRIMARY KEY, input_digest sha256_hex NOT NULL, maximum_micros safe_uint NOT NULL,
 state text NOT NULL CHECK(state IN ('dispatched','completed','uncertain','resolved')), amount_micros safe_uint,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(job_id,step_id),
 FOREIGN KEY(workspace_id,project_id,job_id,step_id) REFERENCES job_steps(workspace_id,project_id,job_id,id),
 CHECK(amount_micros IS NULL OR amount_micros<=maximum_micros)
);
CREATE TABLE fixture_operations (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, project_id uuid NOT NULL, job_id uuid NOT NULL, step_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('provider','runner')), origin text NOT NULL DEFAULT 'fixture' CHECK(origin='fixture'),
 input_digest sha256_hex NOT NULL, lease_epoch safe_uint NOT NULL CHECK(lease_epoch>0),
 state text NOT NULL CHECK(state IN ('requested','completed','uncertain','destroyed')), result_json jsonb CHECK(result_json IS NULL OR json_v1(result_json,262144) IS TRUE),
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(workspace_id,project_id,job_id,step_id) REFERENCES job_steps(workspace_id,project_id,job_id,id)
);
CREATE TABLE cleanup_requests (
 workspace_id uuid NOT NULL, project_id uuid NOT NULL, job_id uuid PRIMARY KEY,
 generation uuid NOT NULL DEFAULT gen_random_uuid(),
 reason text NOT NULL CHECK(reason IN ('cancel','timeout','failure','security-rejection','lease-recovery')),
 confirmed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,project_id,job_id) REFERENCES jobs(workspace_id,project_id,id)
);
CREATE TABLE auth_login_requests (
 bootstrap_hash sha256_hex NOT NULL, key text NOT NULL CHECK(key ~ '^[!-~]{16,128}$'), request_digest sha256_hex NOT NULL,
 response_json jsonb NOT NULL CHECK(json_v1(response_json,8192) IS TRUE), expires_at timestamptz NOT NULL,
 PRIMARY KEY(bootstrap_hash,key)
);
CREATE TABLE request_rates (
 key_hash sha256_hex PRIMARY KEY, window_start timestamptz NOT NULL, attempts integer NOT NULL CHECK(attempts>0)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['job_reviews','fixture_artifact_payloads','provider_attempts','fixture_operations','cleanup_requests'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING (workspace_id=nullif(current_setting(''forge.workspace_id'',true),'''')::uuid) WITH CHECK (workspace_id=nullif(current_setting(''forge.workspace_id'',true),'''')::uuid)',t);
  IF t <> 'fixture_artifact_payloads' THEN EXECUTE format('CREATE INDEX ON %I(workspace_id,project_id,job_id)',t); END IF;
 END LOOP;
END $$;
CREATE INDEX ON fixture_artifact_payloads(workspace_id,project_id,artifact_id);
CREATE INDEX ON provider_attempts(workspace_id,project_id,job_id,step_id);
CREATE INDEX ON fixture_operations(workspace_id,project_id,job_id,step_id);
CREATE INDEX ON cleanup_requests(confirmed_at,created_at);
CREATE TRIGGER immutable_review BEFORE UPDATE OR DELETE ON job_reviews FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER immutable_fixture_payload BEFORE UPDATE OR DELETE ON fixture_artifact_payloads FOR EACH ROW EXECUTE FUNCTION deny_mutation();
-- Grant a non-owner NOLOGIN function owner only enumerated cross-tenant access.
GRANT USAGE,CREATE ON SCHEMA forge_control TO forge_control_guard;
GRANT SELECT ON users,sessions,memberships,workspaces,projects,jobs,job_steps,control_settings,cleanup_requests,environments,previews,preview_tickets,provider_attempts,revoked_policies,workspace_quotas TO forge_control_guard;
GRANT UPDATE ON users,sessions,memberships,workspaces,projects,jobs,job_steps,control_settings,workspace_quotas,preview_tickets TO forge_control_guard;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['memberships','workspaces','projects','jobs','job_steps','cleanup_requests','environments','previews','preview_tickets','provider_attempts','workspace_quotas'] LOOP
  EXECUTE format('CREATE POLICY guard_access ON %I TO forge_control_guard USING(true) WITH CHECK(true)',t);
 END LOOP;
END $$;
CREATE FUNCTION authorize_session(token sha256_hex, workspace uuid DEFAULT NULL, required_role text DEFAULT 'viewer')
 RETURNS TABLE(user_id uuid,role text,csrf_hash sha256_hex) LANGUAGE plpgsql SECURITY DEFINER SET search_path=forge_control,pg_catalog AS $$
DECLARE uid uuid; csrf sha256_hex; membership_role text; BEGIN
 SELECT s.user_id,s.csrf_hash INTO uid,csrf FROM sessions s JOIN users u ON u.id=s.user_id
 WHERE s.id_hash=token AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND u.disabled_at IS NULL FOR SHARE OF s,u;
 IF uid IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE='P0401'; END IF;
 IF workspace IS NOT NULL THEN
  SELECT m.role INTO membership_role FROM memberships m JOIN workspaces w ON w.id=m.workspace_id
   WHERE m.workspace_id=workspace AND m.user_id=uid AND w.disabled_at IS NULL AND w.deleting_at IS NULL FOR SHARE OF m,w;
  IF membership_role IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0404'; END IF;
  IF required_role NOT IN ('viewer','editor','owner') OR (required_role='editor' AND membership_role='viewer') OR (required_role='owner' AND membership_role<>'owner') THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='P0403'; END IF;
  PERFORM set_config('forge.workspace_id',workspace::text,true);
 END IF;
 PERFORM set_config('forge.user_id',uid::text,true);
 RETURN QUERY SELECT uid,membership_role,csrf;
END $$;
CREATE FUNCTION logout_session(token sha256_hex, csrf sha256_hex) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=forge_control,pg_catalog AS $$
DECLARE current_session sessions; BEGIN
 SELECT * INTO current_session FROM sessions WHERE id_hash=token FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE='P0401'; END IF;
 IF current_session.csrf_hash<>csrf THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='P0403'; END IF;
 UPDATE sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE id_hash=token;
 -- E0 has no platform-session FK on tickets: conservative all-user revocation.
 UPDATE preview_tickets SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE user_id=current_session.user_id;
END $$;
CREATE FUNCTION locate_resource(token sha256_hex, resource uuid, kind text) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=forge_control,pg_catalog AS $$
DECLARE workspace uuid; BEGIN
 PERFORM authorize_session(token);
 IF kind='project' THEN SELECT workspace_id INTO workspace FROM projects WHERE id=resource;
 ELSIF kind='job' THEN SELECT workspace_id INTO workspace FROM jobs WHERE id=resource;
 ELSIF kind='snapshot' THEN SELECT workspace_id INTO workspace FROM snapshots WHERE id=resource;
 ELSE RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0404'; END IF;
 IF workspace IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0404'; END IF;
 PERFORM authorize_session(token,workspace,'viewer'); RETURN workspace;
END $$;
GRANT SELECT ON snapshots TO forge_control_guard;
CREATE POLICY guard_access ON snapshots TO forge_control_guard USING(true);
CREATE FUNCTION session_memberships(token sha256_hex) RETURNS TABLE(workspace_id uuid,role text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=forge_control,pg_catalog AS $$
DECLARE uid uuid; BEGIN
 SELECT a.user_id INTO uid FROM authorize_session(token) a;
 RETURN QUERY SELECT m.workspace_id,m.role FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=uid AND w.disabled_at IS NULL AND w.deleting_at IS NULL;
END $$;
CREATE FUNCTION invited_identity(issuer text,subject text) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=forge_control,pg_catalog AS $$
DECLARE uid uuid; BEGIN
 SELECT u.id INTO uid FROM users u WHERE u.oidc_issuer=issuer AND u.oidc_subject=subject AND u.disabled_at IS NULL
 AND EXISTS(SELECT 1 FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=u.id AND w.disabled_at IS NULL AND w.deleting_at IS NULL) FOR SHARE;
 IF uid IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='P0403'; END IF; RETURN uid;
END $$;
CREATE FUNCTION claim_step(worker uuid) RETURNS SETOF job_steps
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=forge_control,pg_catalog AS $$
DECLARE j jobs; selected_step job_steps; settings control_settings; BEGIN
 SELECT * INTO settings FROM control_settings WHERE singleton FOR UPDATE;
 IF NOT FOUND OR NOT settings.worker_enabled OR settings.security_shutdown THEN RETURN; END IF;
 IF (SELECT count(*) FROM job_steps WHERE status='running')>=settings.max_running THEN RETURN; END IF;
 SELECT jobs.* INTO j FROM jobs JOIN projects p ON p.id=jobs.project_id JOIN workspaces w ON w.id=jobs.workspace_id
 WHERE jobs.finished_at IS NULL AND jobs.cleanup_target IS NULL AND jobs.cancel_requested_at IS NULL
 AND p.deleting_at IS NULL AND w.disabled_at IS NULL AND w.deleting_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM revoked_policies r WHERE r.digest IN(jobs.policy_digest,jobs.template_digest))
 AND EXISTS(SELECT 1 FROM job_steps s WHERE s.job_id=jobs.id AND s.stage=jobs.state AND s.status='queued' AND s.available_at<=clock_timestamp())
 AND NOT EXISTS(SELECT 1 FROM cleanup_requests c WHERE c.job_id=jobs.id AND c.confirmed_at IS NULL)
 AND jobs.created_at>clock_timestamp()-interval '7 days'
 AND (jobs.active_deadline_at IS NULL OR jobs.active_deadline_at>clock_timestamp())
 AND (jobs.state<>'QUEUED' OR jobs.created_at>clock_timestamp()-interval '10 minutes')
 AND (SELECT count(*) FROM job_steps active WHERE active.workspace_id=jobs.workspace_id AND active.status='running') <
 COALESCE((SELECT q.max_active_jobs FROM workspace_quotas q WHERE q.workspace_id=jobs.workspace_id ORDER BY period_start DESC LIMIT 1),0)
 ORDER BY jobs.created_at,jobs.id FOR UPDATE OF jobs SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT * INTO selected_step FROM job_steps WHERE job_id=j.id AND stage=j.state AND status='queued' AND available_at<=clock_timestamp() ORDER BY attempt LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 PERFORM set_config('forge.workspace_id',j.workspace_id::text,true);
 UPDATE job_steps SET status='running',lease_owner=worker,lease_epoch=lease_epoch+1,lease_expires_at=clock_timestamp()+interval '60 seconds',started_at=COALESCE(started_at,clock_timestamp()) WHERE id=selected_step.id RETURNING * INTO selected_step;
 RETURN NEXT selected_step;
END $$;
CREATE FUNCTION worker_actor(workspace uuid,actor uuid) RETURNS TABLE(allowed boolean,member_role text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=forge_control,pg_catalog AS $$
DECLARE r text; BEGIN
 SELECT m.role INTO r FROM memberships m JOIN users u ON u.id=m.user_id JOIN workspaces w ON w.id=m.workspace_id
 WHERE m.workspace_id=workspace AND m.user_id=actor AND u.disabled_at IS NULL AND w.disabled_at IS NULL AND w.deleting_at IS NULL FOR SHARE OF m,u,w;
 RETURN QUERY SELECT COALESCE(r IN('owner','editor'),false),r;
END $$;
CREATE FUNCTION lock_admission() RETURNS control_settings
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=forge_control,pg_catalog AS $$
DECLARE settings control_settings; BEGIN
 SELECT * INTO settings FROM control_settings WHERE singleton FOR UPDATE;
 IF NOT FOUND OR NOT settings.admission_enabled OR settings.security_shutdown THEN RAISE EXCEPTION 'ADMISSION_DISABLED' USING ERRCODE='P0503'; END IF;
 IF (SELECT count(*) FROM jobs WHERE state='QUEUED' AND finished_at IS NULL)>=settings.max_queued THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE' USING ERRCODE='P0429'; END IF;
 RETURN settings;
END $$;
-- Reserve simulated preview capacity in the same transaction as inventory creation.
-- A live broker must reserve before any host side effect; this function is fixture-only.
CREATE FUNCTION reserve_fixture_preview(workspace uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=forge_control,pg_catalog AS $$
DECLARE cap integer; global_cap integer; BEGIN
 PERFORM pg_advisory_xact_lock(7100123001);
 SELECT max_previews INTO global_cap FROM control_settings WHERE singleton;
 SELECT max_previews INTO cap FROM workspace_quotas WHERE workspace_id=workspace ORDER BY period_start DESC LIMIT 1 FOR UPDATE;
 IF cap IS NULL OR global_cap IS NULL OR
 (SELECT count(*) FROM environments WHERE kind='preview' AND state<>'destroyed' AND workspace_id=workspace)>=cap OR
 (SELECT count(*) FROM environments WHERE kind='preview' AND state<>'destroyed')>=global_cap THEN
 RAISE EXCEPTION 'CAPACITY_UNAVAILABLE' USING ERRCODE='P0429'; END IF;
END $$;
CREATE FUNCTION maintenance_jobs() RETURNS TABLE(workspace_id uuid,project_id uuid,job_id uuid)
 LANGUAGE sql SECURITY DEFINER SET search_path=forge_control,pg_catalog AS $$
 SELECT j.workspace_id,j.project_id,j.id FROM jobs j WHERE
 (j.finished_at IS NULL AND (j.cleanup_target IS NOT NULL OR j.cancel_requested_at IS NOT NULL
 OR EXISTS(SELECT 1 FROM control_settings WHERE security_shutdown)
 OR EXISTS(SELECT 1 FROM revoked_policies r WHERE r.digest IN(j.policy_digest,j.template_digest))
 OR j.created_at<=clock_timestamp()-interval '7 days'
 OR (j.state='QUEUED' AND j.created_at<=clock_timestamp()-interval '10 minutes')
 OR j.review_expires_at<=clock_timestamp() OR j.active_deadline_at<=clock_timestamp()
 OR EXISTS(SELECT 1 FROM job_steps s WHERE s.job_id=j.id AND s.status='running' AND s.lease_expires_at<=clock_timestamp())
 OR NOT EXISTS(SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=j.created_by AND m.workspace_id=j.workspace_id AND m.role IN ('owner','editor') AND u.disabled_at IS NULL AND w.disabled_at IS NULL AND w.deleting_at IS NULL)))
 OR EXISTS(SELECT 1 FROM cleanup_requests c WHERE c.job_id=j.id AND c.confirmed_at IS NULL)
 OR EXISTS(SELECT 1 FROM environments e WHERE e.job_id=j.id AND e.state<>'destroyed' AND (e.expires_at<=clock_timestamp() OR EXISTS(SELECT 1 FROM control_settings WHERE security_shutdown) OR EXISTS(SELECT 1 FROM revoked_policies r WHERE r.digest IN(j.policy_digest,j.template_digest)) OR NOT (SELECT allowed FROM worker_actor(j.workspace_id,j.created_by))))
 OR EXISTS(SELECT 1 FROM previews p JOIN environments e ON e.id=p.environment_id WHERE e.job_id=j.id AND p.state='READY' AND p.idle_expires_at<=clock_timestamp())
 ORDER BY j.created_at LIMIT 100
$$;
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['authorize_session','locate_resource','session_memberships','invited_identity','claim_step','maintenance_jobs','lock_admission','worker_actor','serialize_revocation','reserve_fixture_preview','logout_session'] LOOP
  EXECUTE (SELECT format('ALTER FUNCTION %s OWNER TO forge_control_guard',oid::regprocedure) FROM pg_proc WHERE pronamespace='forge_control'::regnamespace AND proname=name);
 END LOOP;
END $$;
REVOKE CREATE ON SCHEMA forge_control FROM forge_control_guard;
GRANT USAGE ON SCHEMA forge_control TO forge_control_api,forge_control_worker,forge_control_maintenance;
GRANT EXECUTE ON FUNCTION json_v1(jsonb,integer) TO forge_control_api,forge_control_worker,forge_control_maintenance,forge_control_guard;
GRANT EXECUTE ON FUNCTION authorize_session(sha256_hex,uuid,text),locate_resource(sha256_hex,uuid,text),session_memberships(sha256_hex),invited_identity(text,text) TO forge_control_api;
GRANT EXECUTE ON FUNCTION worker_actor(uuid,uuid) TO forge_control_worker,forge_control_maintenance;
GRANT EXECUTE ON FUNCTION logout_session(sha256_hex,sha256_hex) TO forge_control_api;
GRANT EXECUTE ON FUNCTION lock_admission() TO forge_control_api;
GRANT EXECUTE ON FUNCTION reserve_fixture_preview(uuid) TO forge_control_worker;
GRANT EXECUTE ON FUNCTION claim_step(uuid) TO forge_control_worker;
GRANT EXECUTE ON FUNCTION maintenance_jobs() TO forge_control_maintenance;
GRANT SELECT ON control_settings,revoked_policies,schema_migrations TO forge_control_api,forge_control_worker,forge_control_maintenance;
GRANT UPDATE(singleton) ON control_settings TO forge_control_api,forge_control_worker;
GRANT UPDATE ON control_settings TO forge_control_maintenance;
GRANT SELECT,INSERT,UPDATE ON auth_transactions,sessions,auth_login_requests,request_rates TO forge_control_api;
GRANT SELECT ON memberships,workspaces,users TO forge_control_api,forge_control_worker,forge_control_maintenance;
GRANT SELECT,INSERT,UPDATE ON projects,jobs,job_steps,artifacts,snapshots,usage_reservations,workspace_quotas,idempotency_records,cleanup_requests,environments,previews,app_databases,preview_tickets TO forge_control_api,forge_control_worker,forge_control_maintenance;
GRANT DELETE ON idempotency_records TO forge_control_api;
GRANT SELECT,INSERT ON job_reviews,fixture_artifact_payloads,approvals,job_events,usage_ledger,audit_events TO forge_control_api,forge_control_worker,forge_control_maintenance;
GRANT SELECT,INSERT,UPDATE ON provider_attempts,fixture_operations TO forge_control_worker,forge_control_maintenance;
GRANT SELECT ON provider_attempts,fixture_operations TO forge_control_api;
-- No runtime role can mint membership/invites, waive policies or modify audit data.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA forge_control FROM PUBLIC;
INSERT INTO schema_migrations(version) VALUES(2);
COMMIT;
