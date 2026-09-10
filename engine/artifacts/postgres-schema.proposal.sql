-- Task 06 proposal for Task 01's reserved 0006, NOT an installed migration.
-- Explicitly apply only to disposable data for tests. Same DB as forge_control.
-- No service provisioning, default key, enabled worker or hosted readiness.
BEGIN;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['forge_object_reader','forge_object_writer','forge_object_maintenance','forge_object_guard'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOBYPASSRLS',r);
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r AND (rolsuper OR rolbypassrls OR rolcanlogin OR rolcreatedb OR rolcreaterole OR rolreplication))
    OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles child ON child.oid=m.member WHERE child.rolname=r)
    OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid
      WHERE parent.rolname=r AND m.member<>(SELECT oid FROM pg_roles WHERE rolname=current_user))
    OR EXISTS(SELECT 1 FROM pg_shdepend d JOIN pg_roles target ON target.oid=d.refobjid
      WHERE d.refclassid='pg_authid'::regclass AND target.rolname=r AND d.deptype IN('a','o'))
    THEN RAISE EXCEPTION 'unsafe object role'; END IF;
 END LOOP;
END $$;
GRANT forge_object_guard TO CURRENT_USER;
CREATE SCHEMA forge_objects;
REVOKE ALL ON SCHEMA forge_objects FROM PUBLIC;
GRANT USAGE ON SCHEMA forge_objects TO forge_object_reader,forge_object_writer,forge_object_maintenance,forge_object_guard,forge_control_worker;
-- Required for a non-superuser migration owner to transfer function ownership.
GRANT CREATE ON SCHEMA forge_objects TO forge_object_guard;
CREATE TABLE forge_objects.policy (
 singleton boolean PRIMARY KEY CHECK(singleton),
 orphan_grace_seconds integer NOT NULL CHECK(orphan_grace_seconds BETWEEN 3600 AND 2592000),
 deletion_grace_seconds integer NOT NULL CHECK(deletion_grace_seconds BETWEEN 86400 AND 31536000),
 recovery_window_seconds integer NOT NULL CHECK(recovery_window_seconds BETWEEN 86400 AND 31536000)
);
-- No policy row: operator must deliberately select retention before writes.
CREATE TABLE forge_objects.versions (
 object_key text PRIMARY KEY,
 workspace_id uuid NOT NULL, project_id uuid NOT NULL, job_id uuid NOT NULL, object_id uuid NOT NULL,
 version uuid NOT NULL UNIQUE, key_id text NOT NULL CHECK(key_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$'),
 nonce text NOT NULL CHECK(nonce ~ '^[a-f0-9]{24}$'), tag text NOT NULL CHECK(tag ~ '^[a-f0-9]{32}$'),
 ciphertext bytea CHECK(octet_length(ciphertext)<=33554432),
 state text NOT NULL DEFAULT 'available' CHECK(state IN('available','retired','purged')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), retired_at timestamptz,
 purge_after timestamptz, purged_at timestamptz,
 CHECK(object_key='quarantine/'||workspace_id::text||'/'||project_id::text||'/'||job_id::text||'/'||object_id::text),
 CHECK((state='purged')=(ciphertext IS NULL)),
 CHECK((state='available')=(retired_at IS NULL)),
 CHECK((retired_at IS NULL)=(purge_after IS NULL)),
 CHECK(purge_after IS NULL OR purge_after>=retired_at),
 CHECK((state='purged')=(purged_at IS NOT NULL))
);
ALTER TABLE forge_objects.versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE forge_objects.versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON forge_objects.versions TO forge_object_reader,forge_object_writer USING (
 workspace_id::text=current_setting('forge.object_workspace',true) AND project_id::text=current_setting('forge.object_project',true)
) WITH CHECK (
 workspace_id::text=current_setting('forge.object_workspace',true) AND project_id::text=current_setting('forge.object_project',true)
);
CREATE POLICY guard_access ON forge_objects.versions TO forge_object_guard USING(true) WITH CHECK(true);
GRANT SELECT ON forge_objects.versions TO forge_object_reader,forge_object_writer,forge_object_guard;
GRANT INSERT(object_key,workspace_id,project_id,job_id,object_id,version,key_id,nonce,tag,ciphertext)
 ON forge_objects.versions TO forge_object_writer;
GRANT UPDATE(state,retired_at,purge_after,purged_at,ciphertext) ON forge_objects.versions TO forge_object_guard;
GRANT SELECT ON forge_objects.policy TO forge_object_writer,forge_object_guard;
GRANT USAGE ON SCHEMA forge_control TO forge_object_guard;
GRANT SELECT ON forge_control.artifacts,forge_control.projects,forge_control.jobs TO forge_object_guard;
CREATE POLICY object_guard_access ON forge_control.artifacts TO forge_object_guard USING(true);
CREATE POLICY object_guard_access ON forge_control.projects TO forge_object_guard USING(true);
CREATE POLICY object_guard_access ON forge_control.jobs TO forge_object_guard USING(true);

-- All insert/adopt/retire operations serialize on the same transaction-scoped
-- lock in this database. Hash collisions only serialize unrelated keys.
CREATE FUNCTION forge_objects.lock_key(k text) RETURNS void LANGUAGE sql
 SET search_path=pg_catalog AS $$ SELECT pg_advisory_xact_lock(hashtextextended(k,61006)) $$;
CREATE FUNCTION forge_objects.before_create() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,forge_objects AS $$ BEGIN
 PERFORM forge_objects.lock_key(NEW.object_key);
 IF NOT EXISTS(SELECT 1 FROM forge_objects.policy WHERE singleton) THEN RAISE EXCEPTION 'object retention policy unavailable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER serialize_create BEFORE INSERT ON forge_objects.versions FOR EACH ROW EXECUTE FUNCTION forge_objects.before_create();

CREATE FUNCTION forge_objects.adopt(k text,v uuid,w uuid,p uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,forge_objects AS $$ BEGIN
 IF current_setting('forge.workspace_id',true) IS DISTINCT FROM w::text THEN RAISE EXCEPTION 'object scope rejected'; END IF;
 PERFORM forge_objects.lock_key(k);
 IF NOT EXISTS(SELECT 1 FROM forge_objects.versions WHERE object_key=k AND version=v AND workspace_id=w AND project_id=p AND state='available')
 THEN RAISE EXCEPTION 'object version unavailable'; END IF;
 -- Caller inserts the E1 artifact reference in THIS transaction before commit.
END $$;

CREATE FUNCTION forge_objects.retire(k text,v uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,forge_objects AS $$
DECLARE o forge_objects.versions; policy forge_objects.policy; deadline timestamptz:=clock_timestamp(); BEGIN
 PERFORM forge_objects.lock_key(k);
 SELECT * INTO o FROM forge_objects.versions WHERE object_key=k AND version=v FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'object version unavailable'; END IF;
 IF o.state<>'available' THEN RETURN true; END IF;
 SELECT * INTO STRICT policy FROM forge_objects.policy WHERE singleton;
 IF EXISTS(SELECT 1 FROM forge_control.artifacts a WHERE a.object_key=k) THEN
  -- References never expire individually beneath a live source history. Project
  -- deletion must have cancelled all jobs and passed the deletion grace first.
  IF NOT EXISTS(SELECT 1 FROM forge_control.projects p WHERE p.id=o.project_id AND p.workspace_id=o.workspace_id
    AND p.deleting_at IS NOT NULL AND p.deleting_at<=deadline-make_interval(secs=>policy.deletion_grace_seconds))
    OR EXISTS(SELECT 1 FROM forge_control.jobs j WHERE j.project_id=o.project_id AND j.finished_at IS NULL)
    THEN RETURN false; END IF;
 ELSE
  IF o.created_at>deadline-make_interval(secs=>policy.orphan_grace_seconds) THEN RETURN false; END IF;
 END IF;
 UPDATE forge_objects.versions SET state='retired',retired_at=deadline,
  purge_after=deadline+make_interval(secs=>policy.recovery_window_seconds) WHERE object_key=k;
 RETURN true;
END $$;
CREATE FUNCTION forge_objects.purge(k text,v uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,forge_objects AS $$ DECLARE o forge_objects.versions; policy forge_objects.policy; BEGIN
 PERFORM forge_objects.lock_key(k);
 SELECT * INTO o FROM forge_objects.versions WHERE object_key=k AND version=v FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'object version unavailable'; END IF;
 IF o.state='purged' THEN RETURN true; END IF;
 IF o.state<>'retired' OR o.purge_after>clock_timestamp() THEN RETURN false; END IF;
 SELECT * INTO STRICT policy FROM forge_objects.policy WHERE singleton;
 -- Increasing a retention window applies to already retired bytes too. Reducing
 -- it cannot shorten the originally recorded promise.
 IF o.retired_at+make_interval(secs=>policy.recovery_window_seconds)>clock_timestamp() THEN RETURN false; END IF;
 -- Defense in depth if a privileged restore or buggy future integration installed
 -- an authoritative reference without the required adoption lock/check.
 IF EXISTS(SELECT 1 FROM forge_control.artifacts a WHERE a.object_key=k) AND
   (NOT EXISTS(SELECT 1 FROM forge_control.projects p WHERE p.id=o.project_id AND p.workspace_id=o.workspace_id
      AND p.deleting_at IS NOT NULL AND p.deleting_at<=clock_timestamp()-make_interval(secs=>policy.deletion_grace_seconds))
    OR EXISTS(SELECT 1 FROM forge_control.jobs j WHERE j.project_id=o.project_id AND j.finished_at IS NULL)) THEN RETURN false; END IF;
 UPDATE forge_objects.versions SET state='purged',ciphertext=NULL,purged_at=clock_timestamp() WHERE object_key=k;
 RETURN true;
END $$;
CREATE FUNCTION forge_objects.candidates(after_key text) RETURNS TABLE(object_key text,version uuid,state text)
 LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,forge_objects AS $$
 SELECT o.object_key,o.version,o.state FROM forge_objects.versions o CROSS JOIN forge_objects.policy p
 WHERE p.singleton AND o.object_key>after_key AND
 ((o.state='available' AND o.created_at<=clock_timestamp()-make_interval(secs=>p.orphan_grace_seconds)) OR
  (o.state='retired' AND o.purge_after<=clock_timestamp())) ORDER BY o.object_key LIMIT 100
$$;
ALTER FUNCTION forge_objects.adopt(text,uuid,uuid,uuid) OWNER TO forge_object_guard;
ALTER FUNCTION forge_objects.retire(text,uuid) OWNER TO forge_object_guard;
ALTER FUNCTION forge_objects.purge(text,uuid) OWNER TO forge_object_guard;
ALTER FUNCTION forge_objects.candidates(text) OWNER TO forge_object_guard;
REVOKE CREATE ON SCHEMA forge_objects FROM forge_object_guard;
REVOKE forge_object_guard FROM CURRENT_USER;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA forge_objects FROM PUBLIC;
GRANT EXECUTE ON FUNCTION forge_objects.lock_key(text) TO forge_object_writer,forge_object_guard;
GRANT EXECUTE ON FUNCTION forge_objects.adopt(text,uuid,uuid,uuid) TO forge_control_worker;
GRANT EXECUTE ON FUNCTION forge_objects.retire(text,uuid),forge_objects.purge(text,uuid) TO forge_object_maintenance;
GRANT EXECUTE ON FUNCTION forge_objects.candidates(text) TO forge_object_maintenance;
COMMIT;
