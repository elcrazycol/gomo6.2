-- Custom emoji packs system (Telegram Premium-style)
-- Any user can create packs, other users install and use them inline.

CREATE TABLE IF NOT EXISTS emoji_packs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    icon_url TEXT,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji_count INTEGER DEFAULT 0,
    subscriber_count INTEGER DEFAULT 0,
    is_public BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emoji_packs_author ON emoji_packs(author_id);
CREATE INDEX IF NOT EXISTS idx_emoji_packs_slug ON emoji_packs(slug);
CREATE INDEX IF NOT EXISTS idx_emoji_packs_public ON emoji_packs(is_public) WHERE is_public = TRUE;

CREATE TABLE IF NOT EXISTS custom_emojis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pack_id UUID NOT NULL REFERENCES emoji_packs(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    image_url TEXT NOT NULL,
    is_animated BOOLEAN DEFAULT FALSE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_emojis_pack ON custom_emojis(pack_id);

CREATE TABLE IF NOT EXISTS user_emoji_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pack_id UUID NOT NULL REFERENCES emoji_packs(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, pack_id)
);

CREATE INDEX IF NOT EXISTS idx_emoji_subs_user ON user_emoji_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_emoji_subs_pack ON user_emoji_subscriptions(pack_id);

-- Trigger: auto-update emoji_count on custom_emojis insert/delete
CREATE OR REPLACE FUNCTION update_emoji_pack_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE emoji_packs SET emoji_count = emoji_count + 1 WHERE id = NEW.pack_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE emoji_packs SET emoji_count = emoji_count - 1 WHERE id = OLD.pack_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_custom_emojis_count ON custom_emojis;
CREATE TRIGGER trg_custom_emojis_count
    AFTER INSERT OR DELETE ON custom_emojis
    FOR EACH ROW EXECUTE FUNCTION update_emoji_pack_count();

-- Trigger: auto-update subscriber_count on user_emoji_subscriptions insert/delete
CREATE OR REPLACE FUNCTION update_emoji_pack_subscriber_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE emoji_packs SET subscriber_count = subscriber_count + 1 WHERE id = NEW.pack_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE emoji_packs SET subscriber_count = subscriber_count - 1 WHERE id = OLD.pack_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_emoji_subs_count ON user_emoji_subscriptions;
CREATE TRIGGER trg_emoji_subs_count
    AFTER INSERT OR DELETE ON user_emoji_subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_emoji_pack_subscriber_count();
