CREATE SCHEMA IF NOT EXISTS forge;
CREATE TABLE forge.profiles (
  user_id text PRIMARY KEY REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  onboarding jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0)
);
CREATE TABLE forge.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL UNIQUE REFERENCES neon_auth."user"(id) ON DELETE CASCADE
);
CREATE TABLE forge.memberships (
  workspace_id uuid NOT NULL REFERENCES forge.workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner' CHECK (role = 'owner'),
  PRIMARY KEY(workspace_id,user_id)
);
CREATE TABLE forge.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES forge.workspaces(id) ON DELETE CASCADE,
  brief jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  import_key text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,import_key)
);
CREATE INDEX projects_workspace_updated ON forge.projects(workspace_id,updated_at DESC,id);
-- The API sets the verified subject transaction-locally, never from request JSON.
CREATE FUNCTION forge.user_id() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('forge.user_id',true),'') $$;
ALTER TABLE forge.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE forge.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE forge.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE forge.workspaces FORCE ROW LEVEL SECURITY;
ALTER TABLE forge.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE forge.memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE forge.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE forge.projects FORCE ROW LEVEL SECURITY;
CREATE POLICY profiles_owner ON forge.profiles FOR ALL USING (user_id=forge.user_id()) WITH CHECK(user_id=forge.user_id());
CREATE POLICY workspace_owner ON forge.workspaces FOR ALL USING (owner_id=forge.user_id()) WITH CHECK(owner_id=forge.user_id());
CREATE POLICY membership_owner ON forge.memberships FOR ALL
 USING (user_id=forge.user_id() AND EXISTS(SELECT 1 FROM forge.workspaces w WHERE w.id=workspace_id AND w.owner_id=forge.user_id()))
 WITH CHECK (user_id=forge.user_id() AND EXISTS(SELECT 1 FROM forge.workspaces w WHERE w.id=workspace_id AND w.owner_id=forge.user_id()));
CREATE POLICY project_owner ON forge.projects FOR ALL
 USING (EXISTS(SELECT 1 FROM forge.memberships m WHERE m.workspace_id=projects.workspace_id AND m.user_id=forge.user_id()))
 WITH CHECK (EXISTS(SELECT 1 FROM forge.memberships m WHERE m.workspace_id=projects.workspace_id AND m.user_id=forge.user_id()));
-- Provision forge_app with a separate secret in the deployment secret manager.
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='forge_app') THEN
  CREATE ROLE forge_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
 END IF;
END $$;
GRANT USAGE ON SCHEMA forge TO forge_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA forge TO forge_app;
GRANT EXECUTE ON FUNCTION forge.user_id() TO forge_app;
-- Read only the identity columns needed to reject deleted, banned, or unverified users.
GRANT USAGE ON SCHEMA neon_auth TO forge_app;
GRANT SELECT(id,"emailVerified",banned) ON neon_auth."user" TO forge_app;
GRANT SELECT(id,token,"userId","expiresAt") ON neon_auth.session TO forge_app;
