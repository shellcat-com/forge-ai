-- Application 0004 remains reserved; 0006 belongs to the separate future BYOK draft.
-- Reuse the bounded auth counter table and existing narrow auth-role grants.
ALTER TABLE forge_auth_admission DROP CONSTRAINT forge_auth_admission_key_check;
ALTER TABLE forge_auth_admission ADD CONSTRAINT forge_auth_admission_key_check
 CHECK(key IN ('all','signup','email','login','email_daily'));
