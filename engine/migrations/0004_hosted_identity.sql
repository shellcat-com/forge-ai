-- Requires application auth migrations through 0005 and engine 0001–0003.
-- Run explicitly as migration owner. Does not enable hosted enrollment or builds.
BEGIN;
SET LOCAL search_path=forge_control,pg_catalog;
ALTER TABLE control_settings DROP CONSTRAINT control_settings_environment_check;
ALTER TABLE control_settings ADD CONSTRAINT control_settings_environment_check CHECK(environment IN ('synthetic','hosted'));
CREATE TABLE hosted_identity_settings (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 issuer text NOT NULL CHECK(issuer ~ '^https://[^/]+/api/auth$'),
 enabled boolean NOT NULL DEFAULT false,
 max_users integer NOT NULL DEFAULT 25 CHECK(max_users BETWEEN 1 AND 1000)
);
CREATE TABLE hosted_identities (
 user_id uuid PRIMARY KEY REFERENCES users(id),
 auth_user_id text NOT NULL UNIQUE,
 workspace_id uuid NOT NULL UNIQUE REFERENCES workspaces(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hosted_sessions (
 session_hash sha256_hex PRIMARY KEY REFERENCES sessions(id_hash),
 auth_session_id text NOT NULL UNIQUE,
 user_id uuid NOT NULL REFERENCES hosted_identities(user_id)
);
REVOKE ALL ON hosted_identity_settings,hosted_identities,hosted_sessions FROM PUBLIC;
GRANT SELECT ON hosted_identity_settings TO forge_control_api,forge_control_worker,forge_control_maintenance,forge_control_guard;
GRANT UPDATE(singleton) ON hosted_identity_settings TO forge_control_guard;
GRANT SELECT,INSERT ON hosted_identities,hosted_sessions TO forge_control_guard;
GRANT INSERT ON users,workspaces,memberships,sessions TO forge_control_guard;
GRANT SELECT(id,token,user_id,created_at,expires_at) ON public.forge_session TO forge_control_guard;
GRANT SELECT(id,email_verified,disabled_at) ON public.forge_user TO forge_control_guard;
-- PostgreSQL requires UPDATE privilege for row locks; grant only an identity column.
GRANT UPDATE(id) ON public.forge_session,public.forge_user TO forge_control_guard;

-- No email, user ID, role, issuer or workspace from an HTTP caller is trusted.
-- The exact Better Auth bearer is revalidated against its authoritative row.
CREATE FUNCTION bridge_hosted_session(parent_token text, child_hash sha256_hex, child_csrf sha256_hex)
 RETURNS TABLE(user_id uuid,workspace_id uuid,expires_at timestamptz)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=forge_control,pg_catalog AS $$
DECLARE a record; identity hosted_identities; cfg hosted_identity_settings; existing sessions; BEGIN
 IF parent_token IS NULL OR length(parent_token) NOT BETWEEN 16 AND 512 THEN
  RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE='P0401';
 END IF;
 SELECT s.id,s.user_id,s.created_at,s.expires_at INTO a
 FROM public.forge_session s JOIN public.forge_user u ON u.id=s.user_id
 WHERE s.token=parent_token AND s.expires_at>clock_timestamp()
 AND s.created_at<=clock_timestamp() AND u.email_verified AND u.disabled_at IS NULL
 FOR SHARE OF s,u;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE='P0401'; END IF;
 -- Serialize first enrollment and quota admission without restoring revoked membership.
 PERFORM pg_advisory_xact_lock(hashtextextended('hosted-identity:'||a.user_id,0));
 SELECT * INTO cfg FROM hosted_identity_settings WHERE singleton FOR SHARE;
 IF NOT FOUND OR NOT cfg.enabled THEN RAISE EXCEPTION 'IDENTITY_UNAVAILABLE' USING ERRCODE='P0503'; END IF;
 SELECT * INTO identity FROM hosted_identities h WHERE h.auth_user_id=a.user_id;
 IF NOT FOUND THEN
  PERFORM pg_advisory_xact_lock(7100123004);
  IF (SELECT count(*) FROM hosted_identities)>=cfg.max_users THEN
   RAISE EXCEPTION 'CAPACITY_UNAVAILABLE' USING ERRCODE='P0429';
  END IF;
  identity.user_id:=gen_random_uuid(); identity.workspace_id:=gen_random_uuid();
  INSERT INTO users(id,oidc_issuer,oidc_subject) VALUES(identity.user_id,cfg.issuer,a.user_id);
  INSERT INTO workspaces(id,name) VALUES(identity.workspace_id,'My workspace');
  INSERT INTO memberships(workspace_id,user_id,role) VALUES(identity.workspace_id,identity.user_id,'owner');
  INSERT INTO hosted_identities(user_id,auth_user_id,workspace_id)
   VALUES(identity.user_id,a.user_id,identity.workspace_id);
 END IF;
 PERFORM 1 FROM users u JOIN memberships m ON m.user_id=u.id JOIN workspaces w ON w.id=m.workspace_id
 WHERE u.id=identity.user_id AND u.disabled_at IS NULL AND m.workspace_id=identity.workspace_id
 AND m.role='owner' AND w.disabled_at IS NULL AND w.deleting_at IS NULL FOR SHARE OF u,m,w;
 IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='P0403'; END IF;
 SELECT * INTO existing FROM sessions s WHERE s.id_hash=child_hash FOR SHARE;
 IF FOUND THEN
  IF existing.user_id<>identity.user_id OR existing.csrf_hash<>child_csrf OR existing.revoked_at IS NOT NULL
   OR existing.expires_at<=clock_timestamp() OR NOT EXISTS(
    SELECT 1 FROM hosted_sessions h WHERE h.session_hash=child_hash AND h.auth_session_id=a.id AND h.user_id=identity.user_id
   ) THEN RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE='P0401'; END IF;
 ELSE
  -- Preserve parent creation time: enrollment cannot make an old login fresh again.
  IF a.created_at+interval '12 hours'<=clock_timestamp() THEN RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE='P0401'; END IF;
  INSERT INTO sessions(id_hash,user_id,csrf_hash,created_at,expires_at)
   VALUES(child_hash,identity.user_id,child_csrf,a.created_at,LEAST(a.expires_at,a.created_at+interval '12 hours'));
  INSERT INTO hosted_sessions(session_hash,auth_session_id,user_id) VALUES(child_hash,a.id,identity.user_id);
 END IF;
 RETURN QUERY SELECT identity.user_id,identity.workspace_id,LEAST(a.expires_at,a.created_at+interval '12 hours');
END $$;

CREATE FUNCTION require_hosted_parent(token sha256_hex,uid uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=forge_control,pg_catalog AS $$
DECLARE link hosted_sessions; BEGIN
 -- Fixture/explicit OIDC identities retain their existing policy. Hosted identities
 -- always require a linked live parent, including if someone inserts a child row.
 IF NOT EXISTS(SELECT 1 FROM hosted_identities h WHERE h.user_id=uid) THEN RETURN; END IF;
 SELECT * INTO link FROM hosted_sessions h WHERE h.session_hash=token AND h.user_id=uid;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE='P0401'; END IF;
 PERFORM 1 FROM public.forge_session s JOIN public.forge_user u ON u.id=s.user_id
 JOIN hosted_identities h ON h.auth_user_id=u.id AND h.user_id=uid
 WHERE s.id=link.auth_session_id AND s.expires_at>clock_timestamp()
 AND s.created_at+interval '12 hours'>clock_timestamp() AND u.email_verified AND u.disabled_at IS NULL
 AND EXISTS(SELECT 1 FROM hosted_identity_settings WHERE singleton AND enabled)
 FOR SHARE OF s,u;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE='P0401'; END IF;
END $$;

CREATE OR REPLACE FUNCTION authorize_session(token sha256_hex, workspace uuid DEFAULT NULL, required_role text DEFAULT 'viewer')
 RETURNS TABLE(user_id uuid,role text,csrf_hash sha256_hex) LANGUAGE plpgsql SECURITY DEFINER SET search_path=forge_control,pg_catalog AS $$
DECLARE uid uuid; csrf sha256_hex; membership_role text; BEGIN
 SELECT s.user_id,s.csrf_hash INTO uid,csrf FROM sessions s JOIN users u ON u.id=s.user_id
 WHERE s.id_hash=token AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND u.disabled_at IS NULL FOR SHARE OF s,u;
 IF uid IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE='P0401'; END IF;
 PERFORM require_hosted_parent(token,uid);
 IF workspace IS NOT NULL THEN
  SELECT m.role INTO membership_role FROM memberships m JOIN workspaces w ON w.id=m.workspace_id
   WHERE m.workspace_id=workspace AND m.user_id=uid AND w.disabled_at IS NULL AND w.deleting_at IS NULL FOR SHARE OF m,w;
  IF membership_role IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0404'; END IF;
  IF required_role NOT IN ('viewer','editor','owner') OR (required_role='editor' AND membership_role='viewer') OR (required_role='owner' AND membership_role<>'owner') THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='P0403'; END IF;
  PERFORM set_config('forge.workspace_id',workspace::text,true);
 END IF;
 PERFORM set_config('forge.user_id',uid::text,true);
 PERFORM set_config('forge.session_hash',token::text,true);
 RETURN QUERY SELECT uid,membership_role,csrf;
END $$;

CREATE OR REPLACE FUNCTION worker_actor(workspace uuid,actor uuid) RETURNS TABLE(allowed boolean,member_role text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=forge_control,pg_catalog AS $$
DECLARE r text; BEGIN
 SELECT m.role INTO r FROM memberships m JOIN users u ON u.id=m.user_id JOIN workspaces w ON w.id=m.workspace_id
 WHERE m.workspace_id=workspace AND m.user_id=actor AND u.disabled_at IS NULL AND w.disabled_at IS NULL AND w.deleting_at IS NULL FOR SHARE OF m,u,w;
 IF EXISTS(SELECT 1 FROM hosted_identities h WHERE h.user_id=actor) THEN
  PERFORM 1 FROM public.forge_user u JOIN hosted_identities h ON h.auth_user_id=u.id
  WHERE h.user_id=actor AND u.email_verified AND u.disabled_at IS NULL
  AND EXISTS(SELECT 1 FROM hosted_identity_settings WHERE singleton AND enabled) FOR SHARE OF u;
  IF NOT FOUND THEN r:=NULL; END IF;
 END IF;
 RETURN QUERY SELECT COALESCE(r IN('owner','editor'),false),r;
END $$;
GRANT USAGE,CREATE ON SCHEMA forge_control TO forge_control_guard;
ALTER FUNCTION bridge_hosted_session(text,sha256_hex,sha256_hex) OWNER TO forge_control_guard;
ALTER FUNCTION require_hosted_parent(sha256_hex,uuid) OWNER TO forge_control_guard;
REVOKE CREATE ON SCHEMA forge_control FROM forge_control_guard;
REVOKE ALL ON FUNCTION bridge_hosted_session(text,sha256_hex,sha256_hex),require_hosted_parent(sha256_hex,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bridge_hosted_session(text,sha256_hex,sha256_hex) TO forge_control_api;
INSERT INTO schema_migrations(version) VALUES(4);
COMMIT;
