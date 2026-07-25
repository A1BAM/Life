-- Run this against the LIFTLOGIC Neon database, NOT the Life one.
-- Creates a role that can only read. The Life app gets this role's connection
-- string, so a bug (or a prompt-injected model) cannot write to LiftLogic.
--
-- 1. Pick a strong password, then run this in LiftLogic's Neon SQL Editor.
-- 2. Build the connection string from LiftLogic's normal pooled URL, swapping
--    in this role + password:
--      postgresql://life_reader:<PASSWORD>@<liftlogic-host>/<db>?sslmode=require
-- 3. Store it as the LIFTLOGIC_DATABASE_URL Worker secret.

CREATE ROLE life_reader WITH LOGIN PASSWORD 'REPLACE_ME';

GRANT CONNECT ON DATABASE current_database() TO life_reader;
GRANT USAGE  ON SCHEMA public TO life_reader;

-- Read every existing table...
GRANT SELECT ON ALL TABLES IN SCHEMA public TO life_reader;
-- ...and anything LiftLogic creates later.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO life_reader;

-- Neon-specific: let the role use the project's connection pooler.
GRANT life_reader TO neon_superuser;

-- Verify (should list only SELECT):
--   SELECT grantee, privilege_type, table_name
--   FROM information_schema.role_table_grants
--   WHERE grantee = 'life_reader';
