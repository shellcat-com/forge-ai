-- Allocated by the canonical integration owner; apply only after reviewed 0007.
-- Does not enable scheduling, admission, execution or any network route.
BEGIN;
SET LOCAL search_path=forge_control,pg_catalog;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=4) THEN
  RAISE EXCEPTION 'current session authority migration required';
 END IF;
END $$;
CREATE TABLE scheduler_dispatches (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, project_id uuid NOT NULL,
 job_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES users(id),
 session_hash sha256_hex NOT NULL REFERENCES sessions(id_hash),
 admitted_state_version safe_uint NOT NULL CHECK(admitted_state_version>0),
 policy_digest sha256_hex NOT NULL, template_digest sha256_hex NOT NULL,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 delivery_status text NOT NULL DEFAULT 'pending' CHECK(delivery_status IN('pending','claimed','acknowledged','rejected','unknown')),
 delivery_epoch integer NOT NULL DEFAULT 0 CHECK(delivery_epoch BETWEEN 0 AND 3),
 delivery_owner uuid, delivery_expires_at timestamptz,
 next_sequence integer NOT NULL DEFAULT 0 CHECK(next_sequence BETWEEN 0 AND 30),
 closed_at timestamptz,
 UNIQUE(workspace_id,project_id,job_id,id),
 FOREIGN KEY(workspace_id,project_id,job_id) REFERENCES jobs(workspace_id,project_id,id),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '15 minutes'),
 CHECK((delivery_status='claimed')=(delivery_owner IS NOT NULL AND delivery_expires_at IS NOT NULL)),
 CHECK((delivery_owner IS NULL)=(delivery_expires_at IS NULL)),
 CHECK(delivery_expires_at IS NULL OR delivery_expires_at<=expires_at)
);
-- Expiry does not resolve uncertainty or authorize a replacement dispatch.
CREATE UNIQUE INDEX scheduler_one_open_dispatch ON scheduler_dispatches(job_id) WHERE closed_at IS NULL;
CREATE INDEX scheduler_dispatch_due ON scheduler_dispatches(delivery_status,expires_at) WHERE closed_at IS NULL;
CREATE TABLE scheduler_step_receipts (
 workspace_id uuid NOT NULL, project_id uuid NOT NULL, job_id uuid NOT NULL,
 dispatch_id uuid NOT NULL, sequence integer NOT NULL CHECK(sequence BETWEEN 0 AND 29),
 step_id uuid NOT NULL, lease_owner uuid NOT NULL, lease_epoch safe_uint NOT NULL CHECK(lease_epoch>0),
 operation_id uuid NOT NULL, status text NOT NULL CHECK(status IN('started','settled')),
 result_json jsonb, started_at timestamptz NOT NULL DEFAULT clock_timestamp(), settled_at timestamptz,
 PRIMARY KEY(dispatch_id,sequence), UNIQUE(step_id,lease_epoch),
 FOREIGN KEY(workspace_id,project_id,job_id,dispatch_id) REFERENCES scheduler_dispatches(workspace_id,project_id,job_id,id),
 FOREIGN KEY(workspace_id,project_id,job_id,step_id) REFERENCES job_steps(workspace_id,project_id,job_id,id),
 CHECK((status='settled')=(result_json IS NOT NULL AND settled_at IS NOT NULL)),
 CHECK((result_json IS NULL)=(settled_at IS NULL)),
 CHECK(result_json IS NULL OR ((
  json_v1(result_json,256) IS TRUE AND result_json-ARRAY['schemaVersion','state','retryAfterSeconds']='{}'::jsonb
  AND result_json->>'state' IN('continue','complete','awaiting-approval','cancelled','blocked')
  AND jsonb_typeof(result_json->'retryAfterSeconds')='number'
  AND (CASE WHEN result_json->>'state'='continue'
    THEN (result_json->>'retryAfterSeconds')::numeric BETWEEN 5 AND 60
    ELSE (result_json->>'retryAfterSeconds')::numeric=0 END)
  AND (result_json->>'retryAfterSeconds')::numeric=trunc((result_json->>'retryAfterSeconds')::numeric)
 ) IS TRUE))
);
CREATE INDEX scheduler_receipt_scope ON scheduler_step_receipts(workspace_id,project_id,job_id);
CREATE TABLE scheduler_delivery_receipts (
 workspace_id uuid NOT NULL, project_id uuid NOT NULL, job_id uuid NOT NULL,
 dispatch_id uuid NOT NULL, epoch integer NOT NULL CHECK(epoch BETWEEN 1 AND 3),
 outcome text NOT NULL CHECK(outcome IN('acknowledged','rejected','unknown')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(dispatch_id,epoch),
 FOREIGN KEY(workspace_id,project_id,job_id,dispatch_id) REFERENCES scheduler_dispatches(workspace_id,project_id,job_id,id)
);
CREATE INDEX scheduler_delivery_scope ON scheduler_delivery_receipts(workspace_id,project_id,job_id);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['scheduler_dispatches','scheduler_step_receipts','scheduler_delivery_receipts'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING(workspace_id=nullif(current_setting(''forge.workspace_id'',true),'''')::uuid) WITH CHECK(workspace_id=nullif(current_setting(''forge.workspace_id'',true),'''')::uuid)',t);
 END LOOP;
END $$;
CREATE FUNCTION protect_scheduler_dispatch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (to_jsonb(NEW)-ARRAY['delivery_status','delivery_epoch','delivery_owner','delivery_expires_at','next_sequence','closed_at'])
  IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['delivery_status','delivery_epoch','delivery_owner','delivery_expires_at','next_sequence','closed_at'])
  OR (OLD.closed_at IS NOT NULL AND (NEW.closed_at IS DISTINCT FROM OLD.closed_at OR NEW.next_sequence<>OLD.next_sequence OR NEW.delivery_epoch<>OLD.delivery_epoch))
  OR NEW.delivery_epoch<OLD.delivery_epoch
  OR NEW.delivery_epoch>OLD.delivery_epoch+1 OR NEW.next_sequence<OLD.next_sequence
  OR NEW.next_sequence>OLD.next_sequence+1 THEN
  RAISE EXCEPTION 'immutable dispatch binding' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER scheduler_dispatch_binding BEFORE UPDATE ON scheduler_dispatches FOR EACH ROW EXECUTE FUNCTION protect_scheduler_dispatch();
CREATE TRIGGER scheduler_dispatch_no_delete BEFORE DELETE ON scheduler_dispatches FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE FUNCTION protect_scheduler_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.status<>'started' OR NEW.status<>'settled'
  OR (to_jsonb(NEW)-ARRAY['status','result_json','settled_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','result_json','settled_at']) THEN
  RAISE EXCEPTION 'immutable step receipt' USING ERRCODE='23514';
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER scheduler_step_binding BEFORE UPDATE ON scheduler_step_receipts FOR EACH ROW EXECUTE FUNCTION protect_scheduler_receipt();
CREATE TRIGGER scheduler_step_no_delete BEFORE DELETE ON scheduler_step_receipts FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER scheduler_delivery_immutable BEFORE UPDATE OR DELETE ON scheduler_delivery_receipts FOR EACH ROW EXECUTE FUNCTION deny_mutation();

-- Restricted workers may revalidate only an already admitted dispatch's original
-- session. The session hash never travels through Cloudflare or HTTP responses.
CREATE FUNCTION authorize_scheduler_dispatch(dispatch uuid,workspace uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=forge_control,pg_catalog AS $$
DECLARE d scheduler_dispatches; uid uuid; BEGIN
 IF workspace IS DISTINCT FROM nullif(current_setting('forge.workspace_id',true),'')::uuid THEN
  RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0404';
 END IF;
 SELECT * INTO d FROM scheduler_dispatches WHERE id=dispatch AND workspace_id=workspace;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0404'; END IF;
 SELECT a.user_id INTO uid FROM authorize_session(d.session_hash,workspace,'editor') a;
 IF uid IS DISTINCT FROM d.actor_id THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='P0403'; END IF;
END $$;
CREATE FUNCTION bind_scheduler_dispatch() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=forge_control,pg_catalog AS $$
DECLARE uid uuid; BEGIN
 IF NEW.delivery_status<>'pending' OR NEW.delivery_epoch<>0 OR NEW.delivery_owner IS NOT NULL
  OR NEW.delivery_expires_at IS NOT NULL OR NEW.next_sequence<>0 OR NEW.closed_at IS NOT NULL THEN
  RAISE EXCEPTION 'invalid initial dispatch state' USING ERRCODE='23514';
 END IF;
 IF NEW.session_hash IS DISTINCT FROM nullif(current_setting('forge.session_hash',true),'')::sha256_hex
  OR NEW.workspace_id IS DISTINCT FROM nullif(current_setting('forge.workspace_id',true),'')::uuid THEN
  RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='P0403';
 END IF;
 SELECT a.user_id INTO uid FROM authorize_session(NEW.session_hash,NEW.workspace_id,'editor') a;
 IF uid IS DISTINCT FROM NEW.actor_id OR NOT EXISTS(SELECT 1 FROM jobs j WHERE j.id=NEW.job_id
  AND j.workspace_id=NEW.workspace_id AND j.project_id=NEW.project_id AND j.created_by=uid
  AND j.state_version=NEW.admitted_state_version AND j.policy_digest=NEW.policy_digest
  AND j.template_digest=NEW.template_digest AND j.finished_at IS NULL AND j.cancel_requested_at IS NULL)
 THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='P0403'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER scheduler_actor_binding BEFORE INSERT ON scheduler_dispatches FOR EACH ROW EXECUTE FUNCTION bind_scheduler_dispatch();
CREATE FUNCTION scheduler_running_counts(request_actor uuid) RETURNS TABLE(running bigint,actor bigint)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=forge_control,pg_catalog AS $$ BEGIN
 IF request_actor IS DISTINCT FROM nullif(current_setting('forge.user_id',true),'')::uuid THEN
  RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='P0403';
 END IF;
 RETURN QUERY SELECT count(*),count(*) FILTER(WHERE j.created_by=$1)
 FROM job_steps s JOIN jobs j ON j.id=s.job_id WHERE s.status='running';
END $$;
-- Discovery only. Expired work is never automatically released or re-admitted.
CREATE FUNCTION scheduler_reconciliation_candidates(batch integer DEFAULT 25)
 RETURNS TABLE(dispatch_id uuid,workspace_id uuid,job_id uuid,expires_at timestamptz)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=forge_control,pg_catalog AS $$ BEGIN
 IF batch IS NULL OR batch<1 OR batch>25 THEN RAISE EXCEPTION 'invalid reconciliation bound'; END IF;
 RETURN QUERY SELECT d.id,d.workspace_id,d.job_id,d.expires_at FROM scheduler_dispatches d
 WHERE (d.closed_at IS NULL AND (d.delivery_status IN('pending','unknown') OR d.expires_at<=clock_timestamp()
  OR EXISTS(SELECT 1 FROM scheduler_step_receipts r WHERE r.dispatch_id=d.id AND r.status='started')))
  OR (d.delivery_status='claimed' AND d.delivery_expires_at<=clock_timestamp())
 ORDER BY d.created_at,d.id LIMIT batch;
END $$;
GRANT USAGE,CREATE ON SCHEMA forge_control TO forge_control_guard;
ALTER FUNCTION authorize_scheduler_dispatch(uuid,uuid) OWNER TO forge_control_guard;
ALTER FUNCTION bind_scheduler_dispatch() OWNER TO forge_control_guard;
ALTER FUNCTION scheduler_running_counts(uuid) OWNER TO forge_control_guard;
ALTER FUNCTION scheduler_reconciliation_candidates(integer) OWNER TO forge_control_guard;
REVOKE CREATE ON SCHEMA forge_control FROM forge_control_guard;
GRANT SELECT ON scheduler_dispatches TO forge_control_guard;
GRANT SELECT ON scheduler_step_receipts TO forge_control_guard;
CREATE POLICY scheduler_guard_read ON scheduler_dispatches FOR SELECT TO forge_control_guard USING(true);
CREATE POLICY scheduler_guard_read ON scheduler_step_receipts FOR SELECT TO forge_control_guard USING(true);
REVOKE ALL ON scheduler_dispatches,scheduler_step_receipts,scheduler_delivery_receipts FROM PUBLIC;
REVOKE ALL ON FUNCTION authorize_scheduler_dispatch(uuid,uuid),bind_scheduler_dispatch(),protect_scheduler_dispatch(),protect_scheduler_receipt() FROM PUBLIC;
REVOKE ALL ON FUNCTION scheduler_running_counts(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION scheduler_reconciliation_candidates(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authorize_scheduler_dispatch(uuid,uuid) TO forge_control_worker;
GRANT EXECUTE ON FUNCTION scheduler_running_counts(uuid) TO forge_control_worker;
GRANT EXECUTE ON FUNCTION scheduler_reconciliation_candidates(integer) TO forge_control_maintenance;
GRANT SELECT,INSERT ON scheduler_dispatches TO forge_control_api;
GRANT SELECT,UPDATE ON scheduler_dispatches TO forge_control_worker;
GRANT SELECT,INSERT,UPDATE ON scheduler_step_receipts TO forge_control_worker;
GRANT SELECT,INSERT ON scheduler_delivery_receipts TO forge_control_worker;
GRANT SELECT ON scheduler_dispatches,scheduler_step_receipts,scheduler_delivery_receipts TO forge_control_maintenance;
INSERT INTO schema_migrations(version) VALUES(8);
COMMIT;
