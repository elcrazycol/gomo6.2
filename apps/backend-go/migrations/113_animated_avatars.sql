-- Animated (video) avatars: a flag so clients know to autoplay/loop them.
-- The poster frame is derived from the key (`<key>.poster.jpg`), so it needs no
-- column.

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_animated BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE avatar_history ADD COLUMN IF NOT EXISTS is_animated BOOLEAN NOT NULL DEFAULT FALSE;

-- Copy the flag into history alongside the URL.
CREATE OR REPLACE FUNCTION add_avatar_to_history()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.avatar_url IS NOT NULL AND (OLD.avatar_url IS NULL OR NEW.avatar_url != OLD.avatar_url) THEN
        UPDATE avatar_history
        SET is_current = FALSE
        WHERE user_id = NEW.id;

        INSERT INTO avatar_history (user_id, avatar_url, is_current, is_animated)
        VALUES (NEW.id, NEW.avatar_url, TRUE, COALESCE(NEW.avatar_animated, FALSE));
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_add_avatar_to_history ON users;
CREATE TRIGGER trigger_add_avatar_to_history
    AFTER UPDATE OF avatar_url ON users
    FOR EACH ROW
    EXECUTE FUNCTION add_avatar_to_history();

-- History now carries the flag. The OUT columns change, so the function must be
-- dropped first (CREATE OR REPLACE cannot change the return type).
DROP FUNCTION IF EXISTS get_avatar_history(UUID);
CREATE FUNCTION get_avatar_history(user_uuid UUID)
RETURNS TABLE (
    id UUID,
    avatar_url TEXT,
    uploaded_at TIMESTAMP WITH TIME ZONE,
    is_current BOOLEAN,
    is_animated BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ah.id,
        ah.avatar_url,
        ah.uploaded_at,
        ah.is_current,
        ah.is_animated
    FROM avatar_history ah
    WHERE ah.user_id = user_uuid
    ORDER BY ah.uploaded_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Deleting the current avatar must restore the previous one's animation flag
-- too, not just its URL.
CREATE OR REPLACE FUNCTION delete_avatar_from_history(avatar_id UUID, requesting_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    avatar_user_id UUID;
    avatar_url_to_delete TEXT;
    is_current_avatar BOOLEAN;
    prev_avatar_url TEXT;
    prev_avatar_animated BOOLEAN;
BEGIN
    SELECT user_id, avatar_url, is_current
    INTO avatar_user_id, avatar_url_to_delete, is_current_avatar
    FROM avatar_history
    WHERE id = avatar_id;

    IF avatar_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    IF avatar_user_id != requesting_user_id THEN
        RETURN FALSE;
    END IF;

    DELETE FROM avatar_history WHERE id = avatar_id;

    IF is_current_avatar THEN
        SELECT avatar_url, is_animated
        INTO prev_avatar_url, prev_avatar_animated
        FROM avatar_history
        WHERE user_id = avatar_user_id
        ORDER BY uploaded_at DESC
        LIMIT 1;

        IF prev_avatar_url IS NOT NULL THEN
            UPDATE avatar_history
            SET is_current = TRUE
            WHERE user_id = avatar_user_id AND avatar_url = prev_avatar_url;
        END IF;

        UPDATE users
        SET avatar_url = prev_avatar_url,
            avatar_animated = COALESCE(prev_avatar_animated, FALSE)
        WHERE id = avatar_user_id;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
