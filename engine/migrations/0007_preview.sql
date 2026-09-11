-- Canonical publication of the reviewed Task 07 preview schema.
-- Installs ticket/route authority only; does not enable previews or a runtime.
BEGIN;
SET LOCAL search_path=forge_control,pg_catalog;
ALTER TABLE preview_tickets ADD COLUMN parent_session_hash sha256_hex REFERENCES sessions(id_hash);
ALTER TABLE preview_tickets ADD COLUMN generation uuid;
ALTER TABLE preview_tickets ADD COLUMN hostname text;
CREATE TABLE preview_routes (
 preview_id uuid PRIMARY KEY REFERENCES previews(id), hostname text NOT NULL UNIQUE
 CHECK(hostname ~ '^[a-z0-9][a-z0-9.-]{0,251}[a-z0-9]$'),
 environment_id uuid NOT NULL UNIQUE REFERENCES environments(id), generation uuid NOT NULL UNIQUE,
 operation_id uuid NOT NULL, lease_epoch safe_uint NOT NULL CHECK(lease_epoch>0),
 revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
-- Hostnames and routing identities are never reassigned, even after expiry.
CREATE FUNCTION protect_preview_route() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'revoked_at')
 OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
 RAISE EXCEPTION 'immutable preview route' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER immutable_preview_route BEFORE UPDATE OR DELETE ON preview_routes FOR EACH ROW EXECUTE FUNCTION protect_preview_route();
ALTER TABLE preview_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE preview_routes FORCE ROW LEVEL SECURITY;
CREATE POLICY guard_access ON preview_routes TO forge_control_guard USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON preview_routes TO forge_control_guard;
GRANT INSERT ON preview_tickets TO forge_control_guard;
GRANT UPDATE ON previews TO forge_control_guard;
GRANT UPDATE(id,expires_at) ON environments TO forge_control_guard;
GRANT USAGE,CREATE ON SCHEMA forge_control TO forge_control_guard;

-- Authenticated worker registers ONLY an already-ready exact canonical environment.
-- Task 02 must first prove its signed runtime receipt; no request-selected URL exists.
CREATE FUNCTION register_preview_route(pid uuid, host text, env uuid, gen uuid, op uuid, epoch safe_uint) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=forge_control,pg_catalog AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM previews p JOIN environments e ON e.id=p.environment_id
 WHERE p.id=pid AND p.workspace_id=nullif(current_setting('forge.workspace_id',true),'')::uuid
 AND p.environment_id=env AND p.generation=gen AND e.broker_operation_id=op AND e.lease_epoch=epoch
 AND p.state='READY' AND e.state='ready' AND e.kind='preview' AND e.expires_at>clock_timestamp()
 AND p.absolute_expires_at>clock_timestamp() AND p.idle_expires_at>clock_timestamp()) THEN
 RAISE EXCEPTION 'PREVIEW_UNAVAILABLE' USING ERRCODE='P0503'; END IF;
 INSERT INTO preview_routes(preview_id,hostname,environment_id,generation,operation_id,lease_epoch)
 VALUES(pid,host,env,gen,op,epoch);
END $$;

-- Never cache this decision. Parent login, viewer membership and environment are
-- rechecked on exchange, every request, renewal, and again before releasing bytes.
CREATE FUNCTION preview_grant(parent sha256_hex, pid uuid, host text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=forge_control,pg_catalog AS $$
DECLARE p previews; e environments; r preview_routes; uid uuid; parent_exp timestamptz; BEGIN
 -- Unlocked rows locate scope only; authority comes from locks + revalidation.
 SELECT * INTO p FROM previews WHERE id=pid;
 IF NOT FOUND THEN RAISE EXCEPTION 'PREVIEW_UNAUTHORIZED' USING ERRCODE='P0401'; END IF;
 SELECT a.user_id INTO uid FROM authorize_session(parent,p.workspace_id,'viewer') a;
 PERFORM singleton FROM control_settings FOR SHARE;
 PERFORM id FROM projects WHERE id=p.project_id FOR SHARE;
 PERFORM j.id FROM jobs j JOIN environments x ON x.job_id=j.id WHERE x.id=p.environment_id FOR SHARE OF j;
 -- Exclusive from the outset: different viewers cannot deadlock upgrading idle renewal.
 SELECT * INTO p FROM previews WHERE id=pid FOR UPDATE;
 SELECT * INTO e FROM environments WHERE id=p.environment_id FOR SHARE;
 SELECT * INTO r FROM preview_routes WHERE preview_id=pid AND hostname=host AND revoked_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PREVIEW_UNAUTHORIZED' USING ERRCODE='P0401'; END IF;
 SELECT expires_at INTO parent_exp FROM sessions WHERE id_hash=parent;
 IF p.state<>'READY' OR e.state<>'ready' OR e.kind<>'preview'
 OR p.generation<>r.generation OR e.id<>r.environment_id OR e.broker_operation_id<>r.operation_id OR e.lease_epoch<>r.lease_epoch
 OR least(p.absolute_expires_at,p.idle_expires_at,e.expires_at)<=clock_timestamp()
 OR EXISTS(SELECT 1 FROM projects WHERE id=p.project_id AND deleting_at IS NOT NULL)
 OR NOT EXISTS(SELECT 1 FROM control_settings WHERE singleton AND NOT security_shutdown)
 OR EXISTS(SELECT 1 FROM jobs j WHERE j.id=e.job_id AND (j.cancel_requested_at IS NOT NULL OR j.cleanup_target IS NOT NULL
 OR j.state IN('FAILED','CANCELLED','EXPIRED','CANCELLING') OR EXISTS(SELECT 1 FROM revoked_policies rp WHERE rp.digest IN(j.policy_digest,j.template_digest))))
 OR EXISTS(SELECT 1 FROM cleanup_requests WHERE job_id=e.job_id AND confirmed_at IS NULL) THEN
 RAISE EXCEPTION 'PREVIEW_UNAVAILABLE' USING ERRCODE='P0503'; END IF;
 RETURN jsonb_build_object('schemaVersion',1,'previewId',p.id,'generation',p.generation,'workspaceId',p.workspace_id,
 'projectId',p.project_id,'userId',uid,'hostname',host,'state','READY','authorized',true,
 'authorizedAt',clock_timestamp(),'sessionExpiresAt',least(parent_exp,p.absolute_expires_at,e.expires_at,clock_timestamp()+interval '30 minutes'),
 'idleExpiresAt',p.idle_expires_at,'absoluteExpiresAt',least(p.absolute_expires_at,e.expires_at),
 'environmentId',e.id,'operationId',e.broker_operation_id,'leaseEpoch',e.lease_epoch,
 'jobId',e.job_id,'snapshotId',e.snapshot_id,'sourceManifestDigest',(SELECT manifest_digest FROM snapshots WHERE id=e.snapshot_id),
 'templateDigest',(SELECT template_digest FROM snapshots WHERE id=e.snapshot_id));
END $$;
CREATE FUNCTION issue_preview_ticket(parent sha256_hex, csrf sha256_hex, pid uuid, host text, token sha256_hex) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=forge_control,pg_catalog AS $$
DECLARE g jsonb; BEGIN
 IF NOT EXISTS(SELECT 1 FROM authorize_session(parent) a WHERE a.csrf_hash=csrf) THEN
 RAISE EXCEPTION 'CSRF_INVALID' USING ERRCODE='P0403'; END IF;
 g:=preview_grant(parent,pid,host);
 INSERT INTO preview_tickets(token_hash,workspace_id,project_id,preview_id,user_id,purpose,expires_at,parent_session_hash,generation,hostname)
 VALUES(token,(g->>'workspaceId')::uuid,(g->>'projectId')::uuid,pid,(g->>'userId')::uuid,'launch',
 least(now()+interval '60 seconds',(g->>'sessionExpiresAt')::timestamptz),parent,(g->>'generation')::uuid,host);
 RETURN g;
END $$;
CREATE FUNCTION consume_preview_ticket(token sha256_hex, host text, new_token sha256_hex) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=forge_control,pg_catalog AS $$
DECLARE t preview_tickets; g jsonb; BEGIN
 SELECT * INTO t FROM preview_tickets WHERE token_hash=token AND purpose='launch' AND hostname=host
 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>clock_timestamp() AND parent_session_hash IS NOT NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'PREVIEW_UNAUTHORIZED' USING ERRCODE='P0401'; END IF;
 g:=preview_grant(t.parent_session_hash,t.preview_id,host);
 SELECT * INTO t FROM preview_tickets WHERE token_hash=token AND hostname=host
 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PREVIEW_UNAUTHORIZED' USING ERRCODE='P0401'; END IF;
 IF (g->>'generation')::uuid<>t.generation THEN RAISE EXCEPTION 'PREVIEW_UNAUTHORIZED' USING ERRCODE='P0401'; END IF;
 UPDATE preview_tickets SET consumed_at=clock_timestamp() WHERE token_hash=token;
 INSERT INTO preview_tickets(token_hash,workspace_id,project_id,preview_id,user_id,purpose,expires_at,parent_session_hash,generation,hostname)
 VALUES(new_token,t.workspace_id,t.project_id,t.preview_id,t.user_id,'session',(g->>'sessionExpiresAt')::timestamptz,t.parent_session_hash,t.generation,host);
 RETURN g;
END $$;
CREATE FUNCTION authorize_preview(token sha256_hex, host text, replacement sha256_hex DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=forge_control,pg_catalog AS $$
DECLARE t preview_tickets; g jsonb; BEGIN
 SELECT * INTO t FROM preview_tickets WHERE token_hash=token AND purpose='session' AND hostname=host
 AND revoked_at IS NULL AND consumed_at IS NULL AND expires_at>clock_timestamp() AND parent_session_hash IS NOT NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'PREVIEW_UNAUTHORIZED' USING ERRCODE='P0401'; END IF;
 g:=preview_grant(t.parent_session_hash,t.preview_id,host);
 SELECT * INTO t FROM preview_tickets WHERE token_hash=token AND hostname=host
 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PREVIEW_UNAUTHORIZED' USING ERRCODE='P0401'; END IF;
 IF (g->>'generation')::uuid<>t.generation THEN RAISE EXCEPTION 'PREVIEW_UNAUTHORIZED' USING ERRCODE='P0401'; END IF;
 IF replacement IS NULL THEN
 g:=jsonb_set(g,'{sessionExpiresAt}',to_jsonb(least(t.expires_at,(g->>'sessionExpiresAt')::timestamptz)));
 ELSE
 -- Explicit same-origin renewal rotates the credential and extends idle lifetime,
 -- never the two-hour preview/parent login/environment absolute bounds.
 UPDATE previews SET idle_expires_at=least(absolute_expires_at,clock_timestamp()+interval '15 minutes'),last_user_activity_at=clock_timestamp() WHERE id=t.preview_id;
 g:=preview_grant(t.parent_session_hash,t.preview_id,host);
 UPDATE preview_tickets SET revoked_at=clock_timestamp() WHERE token_hash=token;
 INSERT INTO preview_tickets(token_hash,workspace_id,project_id,preview_id,user_id,purpose,expires_at,parent_session_hash,generation,hostname)
 VALUES(replacement,t.workspace_id,t.project_id,t.preview_id,t.user_id,'session',(g->>'sessionExpiresAt')::timestamptz,t.parent_session_hash,t.generation,host);
 END IF;
 RETURN g;
END $$;
CREATE FUNCTION revoke_preview(parent sha256_hex, csrf sha256_hex, pid uuid, host text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=forge_control,pg_catalog AS $$
DECLARE wid uuid; BEGIN
 SELECT workspace_id INTO wid FROM previews WHERE id=pid;
 IF NOT EXISTS(SELECT 1 FROM authorize_session(parent,wid,'editor') a WHERE a.csrf_hash=csrf) THEN
 RAISE EXCEPTION 'CSRF_INVALID' USING ERRCODE='P0403'; END IF;
 PERFORM singleton FROM control_settings FOR SHARE;
 PERFORM pr.id FROM projects pr JOIN previews p ON p.project_id=pr.id WHERE p.id=pid FOR SHARE OF pr;
 PERFORM j.id FROM jobs j JOIN environments e ON e.job_id=j.id JOIN previews p ON p.environment_id=e.id WHERE p.id=pid FOR SHARE OF j;
 PERFORM id FROM previews WHERE id=pid FOR UPDATE;
 UPDATE preview_routes SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE preview_id=pid AND hostname=host;
 UPDATE preview_tickets SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE preview_id=pid;
 UPDATE previews SET state='STOPPING' WHERE id=pid AND state='READY';
 -- Existing canonical reconciler discovers expired environments and owns teardown.
 UPDATE environments SET expires_at=least(expires_at,clock_timestamp()) WHERE id IN(SELECT environment_id FROM previews WHERE id=pid);
END $$;
CREATE FUNCTION cleanup_preview_credentials() RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=forge_control,pg_catalog AS $$
DECLARE n integer; BEGIN
 UPDATE preview_routes r SET revoked_at=clock_timestamp() WHERE r.revoked_at IS NULL AND EXISTS
 (SELECT 1 FROM previews p JOIN environments e ON e.id=p.environment_id WHERE p.id=r.preview_id AND
 (p.state<>'READY' OR e.state<>'ready' OR least(p.absolute_expires_at,p.idle_expires_at,e.expires_at)<=clock_timestamp()));
 UPDATE preview_tickets t SET revoked_at=clock_timestamp() WHERE t.revoked_at IS NULL AND
 (t.expires_at<=clock_timestamp()
 OR EXISTS(SELECT 1 FROM control_settings WHERE security_shutdown)
 OR EXISTS(SELECT 1 FROM workspaces w WHERE w.id=t.workspace_id AND (w.disabled_at IS NOT NULL OR w.deleting_at IS NOT NULL))
 OR EXISTS(SELECT 1 FROM projects p WHERE p.id=t.project_id AND p.deleting_at IS NOT NULL)
 OR EXISTS(SELECT 1 FROM preview_routes r WHERE r.preview_id=t.preview_id AND r.revoked_at IS NOT NULL)
 OR EXISTS(SELECT 1 FROM previews p JOIN environments e ON e.id=p.environment_id
 WHERE p.id=t.preview_id AND (p.state<>'READY' OR e.state<>'ready' OR least(p.absolute_expires_at,p.idle_expires_at,e.expires_at)<=clock_timestamp()))
 OR EXISTS(SELECT 1 FROM sessions s WHERE s.id_hash=t.parent_session_hash AND (s.revoked_at IS NOT NULL OR s.expires_at<=clock_timestamp()))
 OR NOT EXISTS(SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.user_id=t.user_id AND m.workspace_id=t.workspace_id AND u.disabled_at IS NULL));
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN n;
END $$;
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['register_preview_route','preview_grant','issue_preview_ticket','consume_preview_ticket','authorize_preview','revoke_preview','cleanup_preview_credentials'] LOOP
 EXECUTE (SELECT format('ALTER FUNCTION %s OWNER TO forge_control_guard',oid::regprocedure) FROM pg_proc WHERE pronamespace='forge_control'::regnamespace AND proname=name);
 END LOOP;
END $$;
REVOKE CREATE ON SCHEMA forge_control FROM forge_control_guard;
REVOKE ALL ON FUNCTION protect_preview_route(),register_preview_route(uuid,text,uuid,uuid,uuid,safe_uint),preview_grant(sha256_hex,uuid,text),issue_preview_ticket(sha256_hex,sha256_hex,uuid,text,sha256_hex),consume_preview_ticket(sha256_hex,text,sha256_hex),authorize_preview(sha256_hex,text,sha256_hex),revoke_preview(sha256_hex,sha256_hex,uuid,text),cleanup_preview_credentials() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_preview_route(uuid,text,uuid,uuid,uuid,safe_uint) TO forge_control_worker;
GRANT EXECUTE ON FUNCTION issue_preview_ticket(sha256_hex,sha256_hex,uuid,text,sha256_hex),consume_preview_ticket(sha256_hex,text,sha256_hex),authorize_preview(sha256_hex,text,sha256_hex),revoke_preview(sha256_hex,sha256_hex,uuid,text) TO forge_control_api;
GRANT EXECUTE ON FUNCTION cleanup_preview_credentials() TO forge_control_maintenance;
INSERT INTO schema_migrations(version) VALUES(7);
COMMIT;
