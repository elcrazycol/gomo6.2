-- 123_user_activity_events.sql
--
-- Append-only activity ledger: one row per user action. Two consumers:
--   1. moderation — "what did user X do", to investigate reports and ban bad
--      behaviour that no current counter can show;
--   2. honest time-series — daily activity graphs, which cannot be reconstructed
--      from the denormalized counters in users.*.
--
-- Deliberately narrow and content-free: NO message bodies, NO DM events and NO
-- IP addresses. Private conversations are out of scope by design (see
-- achievements.EventType) and a behavioural log has no business storing IPs.
--
-- Retention is by monthly RANGE partition, so old data is dropped with DROP
-- TABLE (O(1) — no bloat, no vacuum churn). ensure_activity_partitions() creates
-- the current month plus a few ahead; drop_old_activity_partitions(n) removes
-- older ones. Both are driven by the backend (internal/activity) at startup and
-- on a timer, so no pg_cron / external scheduler is required.
--
-- A DEFAULT partition is the safety net: if a month is missing (long downtime)
-- the row still lands instead of failing the insert. ensure() wraps each CREATE
-- in an exception block, so a populated DEFAULT can never abort maintenance.

CREATE TABLE IF NOT EXISTS user_activity_events (
    id          BIGSERIAL,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type  TEXT NOT NULL,
    target_type TEXT,
    target_id   UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- Moderation lookup + keyset pagination: the newest actions of one user.
CREATE INDEX IF NOT EXISTS idx_user_activity_user_created
    ON user_activity_events (user_id, created_at DESC, id DESC);

-- Retention / whole-range aggregation: BRIN is tiny and cheap to maintain on an
-- append-only table, unlike a btree on created_at.
CREATE INDEX IF NOT EXISTS idx_user_activity_created_brin
    ON user_activity_events USING BRIN (created_at);

CREATE TABLE IF NOT EXISTS user_activity_events_default
    PARTITION OF user_activity_events DEFAULT;

-- ensure_activity_partitions creates the current (UTC) month and months_ahead
-- more, so inserts never touch the DEFAULT partition in normal operation.
CREATE OR REPLACE FUNCTION ensure_activity_partitions(months_ahead int DEFAULT 3)
RETURNS void AS $$
DECLARE
    i           int;
    start_month timestamptz;
    next_month  timestamptz;
    part_name   text;
BEGIN
    FOR i IN 0..months_ahead LOOP
        start_month := (date_trunc('month', (NOW() AT TIME ZONE 'UTC')) AT TIME ZONE 'UTC')
                       + (i || ' months')::interval;
        next_month  := start_month + interval '1 month';
        part_name   := 'user_activity_events_' || to_char(start_month AT TIME ZONE 'UTC', 'YYYY_MM');
        BEGIN
            EXECUTE format(
                'CREATE TABLE IF NOT EXISTS %I PARTITION OF user_activity_events FOR VALUES FROM (%L) TO (%L)',
                part_name, start_month, next_month);
        EXCEPTION WHEN others THEN
            -- e.g. the range already holds rows in the DEFAULT partition. The
            -- rows still land somewhere, so maintenance must never abort.
            NULL;
        END;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- drop_old_activity_partitions drops every partition fully older than
-- keep_months. The DEFAULT partition is never touched.
CREATE OR REPLACE FUNCTION drop_old_activity_partitions(keep_months int DEFAULT 6)
RETURNS void AS $$
DECLARE
    cutoff timestamptz;
    pt     record;
BEGIN
    IF keep_months < 1 THEN
        RETURN;
    END IF;
    cutoff := (date_trunc('month', (NOW() AT TIME ZONE 'UTC')) AT TIME ZONE 'UTC')
              - (keep_months || ' months')::interval;
    FOR pt IN
        SELECT c.relname
        FROM pg_class c
        JOIN pg_inherits i ON i.inhrelid = c.oid
        JOIN pg_class p ON p.oid = i.inhparent
        WHERE p.relname = 'user_activity_events'
          AND c.relname LIKE 'user_activity_events\_%' ESCAPE '\'
          AND c.relname <> 'user_activity_events_default'
          -- names are YYYY_MM, so lexical comparison is chronological
          AND substring(c.relname from '(\d{4}_\d{2})$')
              < to_char(cutoff AT TIME ZONE 'UTC', 'YYYY_MM')
    LOOP
        EXECUTE format('DROP TABLE IF EXISTS %I', pt.relname);
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Seed the current month + three ahead so the first insert never needs DEFAULT.
SELECT ensure_activity_partitions(3);
