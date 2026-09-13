-- Permit only the additional session metadata required for fresh-auth checks.
-- Runtime roles still cannot write managed authentication records.
GRANT SELECT ("createdAt") ON neon_auth.session TO forge_app;
