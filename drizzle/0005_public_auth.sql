-- 0004 remains reserved for the separately reviewed account/control identity bridge.
-- Additive; never resets users, sessions, projects or generated application data.
ALTER TABLE forge_user ADD COLUMN disabled_at timestamptz;
CREATE TABLE forge_auth_admission (
  key text PRIMARY KEY CHECK(key IN ('all','signup','email','login')),
  window_start timestamptz NOT NULL,
  attempts integer NOT NULL CHECK(attempts BETWEEN 1 AND 200)
);
REVOKE ALL ON forge_auth_admission FROM PUBLIC;
