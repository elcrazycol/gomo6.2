-- 122_pg_stat_statements.sql
--
-- Enables pg_stat_statements so postgres_exporter can expose "top queries by
-- total time" (the single most useful database metric). The library must be
-- preloaded, which docker-compose sets via
--   command: ["postgres", "-c", "shared_preload_libraries=pg_stat_statements"]
--
-- Best-effort on purpose: this is a monitoring nicety, and a failure here must
-- never keep the backend from booting. If the module is unavailable the
-- migration logs a notice and the rest of the system is unaffected.

DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_stat_statements unavailable (monitoring only, ignored): %', SQLERRM;
END;
$$;
