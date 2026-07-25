-- Run this only if you already applied an earlier 001_init.sql.
-- Question generation was removed, so the tables that held uploaded lecture
-- text are no longer used. Dropping them loses nothing else.
DROP TABLE IF EXISTS ingest_chunks;
DROP TABLE IF EXISTS ingest_jobs;
