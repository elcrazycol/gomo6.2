-- Custom emoji discovery uses standard Unicode emoji as the visible trigger.
-- The old name column remains for backwards compatibility and storage paths;
-- it is no longer exposed as a :name: shortcode in the UI.
ALTER TABLE custom_emojis
    ADD COLUMN IF NOT EXISTS unicode_triggers JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Legacy rows may not have a visible trigger yet. Keep them readable while
-- enforcing 1–3 triggers for every new/updated row in the generic API.
ALTER TABLE custom_emojis
    DROP CONSTRAINT IF EXISTS custom_emojis_unicode_triggers_check;

ALTER TABLE custom_emojis
    ADD CONSTRAINT custom_emojis_unicode_triggers_check
    CHECK (
        jsonb_typeof(unicode_triggers) = 'array'
        AND jsonb_array_length(unicode_triggers) BETWEEN 0 AND 3
    );

CREATE INDEX IF NOT EXISTS idx_custom_emojis_unicode_triggers
    ON custom_emojis USING GIN (unicode_triggers);
