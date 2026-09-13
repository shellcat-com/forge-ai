CREATE TABLE forge.provider_connections (
  user_id uuid NOT NULL REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('deepseek','nvidia')),
  ciphertext text NOT NULL,
  fingerprint text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);
CREATE TABLE forge.provider_requests (
  user_id uuid NOT NULL REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  PRIMARY KEY (user_id, request_id)
);
CREATE INDEX provider_requests_budget ON forge.provider_requests(user_id, created_at);
ALTER TABLE forge.provider_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE forge.provider_connections FORCE ROW LEVEL SECURITY;
ALTER TABLE forge.provider_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE forge.provider_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY own_provider_connections ON forge.provider_connections
  USING (user_id = nullif(current_setting('forge.user_id',true),'')::uuid)
  WITH CHECK (user_id = nullif(current_setting('forge.user_id',true),'')::uuid);
CREATE POLICY own_provider_requests ON forge.provider_requests
  USING (user_id = nullif(current_setting('forge.user_id',true),'')::uuid)
  WITH CHECK (user_id = nullif(current_setting('forge.user_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON forge.provider_connections,forge.provider_requests TO forge_app;
