-- Optional E2 candidate-source bridge. No live provenance, paid admission or runner grants.
BEGIN;
SET LOCAL search_path=forge_control,pg_catalog;
CREATE TABLE job_source_contexts (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid PRIMARY KEY,
  base_manifest_artifact_id uuid NOT NULL,
  diff_artifact_id uuid,
  FOREIGN KEY(workspace_id,project_id,job_id) REFERENCES jobs(workspace_id,project_id,id),
  FOREIGN KEY(workspace_id,project_id,base_manifest_artifact_id) REFERENCES artifacts(workspace_id,project_id,id),
  FOREIGN KEY(workspace_id,project_id,diff_artifact_id) REFERENCES artifacts(workspace_id,project_id,id)
);
ALTER TABLE job_source_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_source_contexts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON job_source_contexts
 USING(workspace_id=nullif(current_setting('forge.workspace_id',true),'')::uuid)
 WITH CHECK(workspace_id=nullif(current_setting('forge.workspace_id',true),'')::uuid);
GRANT SELECT ON job_source_contexts TO forge_control_api,forge_control_worker,forge_control_maintenance;
GRANT INSERT ON job_source_contexts TO forge_control_worker;
GRANT UPDATE(diff_artifact_id) ON job_source_contexts TO forge_control_worker;
CREATE TABLE source_exports (
 workspace_id uuid NOT NULL, project_id uuid NOT NULL, artifact_id uuid PRIMARY KEY, snapshot_id uuid NOT NULL,
 scan_policy_digest sha256_hex NOT NULL, verification_digest sha256_hex NOT NULL, expires_at timestamptz NOT NULL,
 FOREIGN KEY(workspace_id,project_id,artifact_id) REFERENCES artifacts(workspace_id,project_id,id),
 FOREIGN KEY(workspace_id,project_id,snapshot_id) REFERENCES snapshots(workspace_id,project_id,id)
);
ALTER TABLE source_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_exports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON source_exports
 USING(workspace_id=nullif(current_setting('forge.workspace_id',true),'')::uuid)
 WITH CHECK(workspace_id=nullif(current_setting('forge.workspace_id',true),'')::uuid);
CREATE TRIGGER immutable_source_export BEFORE UPDATE OR DELETE ON source_exports FOR EACH ROW EXECUTE FUNCTION deny_mutation();
GRANT SELECT,INSERT ON source_exports TO forge_control_api;
GRANT SELECT ON source_exports TO forge_control_worker,forge_control_maintenance;
-- Extend the frozen E1 locator without weakening existing session/membership checks.
GRANT SELECT ON artifacts TO forge_control_guard;
CREATE POLICY guard_access ON artifacts TO forge_control_guard USING(true);
CREATE OR REPLACE FUNCTION locate_resource(token sha256_hex, resource uuid, kind text) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=forge_control,pg_catalog AS $$
DECLARE workspace uuid; BEGIN
 PERFORM authorize_session(token);
 IF kind='project' THEN SELECT workspace_id INTO workspace FROM projects WHERE id=resource;
 ELSIF kind='job' THEN SELECT workspace_id INTO workspace FROM jobs WHERE id=resource;
 ELSIF kind='snapshot' THEN SELECT workspace_id INTO workspace FROM snapshots WHERE id=resource;
 ELSIF kind='artifact' THEN SELECT a.workspace_id INTO workspace FROM artifacts a JOIN projects p ON p.id=a.project_id
  WHERE a.id=resource AND a.status='available' AND (a.expires_at IS NULL OR a.expires_at>clock_timestamp()) AND p.deleting_at IS NULL;
 ELSE RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0404'; END IF;
 IF workspace IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0404'; END IF;
 PERFORM authorize_session(token,workspace,'viewer'); RETURN workspace;
END $$;
INSERT INTO schema_migrations(version) VALUES(3);
COMMIT;
