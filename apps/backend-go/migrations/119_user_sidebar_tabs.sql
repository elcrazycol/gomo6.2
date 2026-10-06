-- 119_user_sidebar_tabs.sql
--
-- Custom sidebar tabs: a раздел/подраздел the user pinned to the sidebar under
-- their own name, optionally opening instead of the feed. Synced across
-- devices, private to the owner.
--
-- The section is referenced by slug (the frontend already works in slugs and
-- the catalog is seeded/stable), so a renamed section keeps its tabs.

CREATE TABLE IF NOT EXISTS user_sidebar_tabs (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    section_slug    VARCHAR(64) NOT NULL,
    subsection_slug VARCHAR(64),
    label           VARCHAR(64) NOT NULL,
    is_home         BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sidebar_tabs_user
    ON user_sidebar_tabs(user_id, created_at);

-- At most one home tab per user.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_sidebar_tabs_one_home
    ON user_sidebar_tabs(user_id)
    WHERE is_home;

GRANT SELECT, INSERT, UPDATE, DELETE ON user_sidebar_tabs TO gomo6;
