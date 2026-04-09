-- Avatar history table
CREATE TABLE IF NOT EXISTS avatar_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    avatar_url TEXT NOT NULL,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_current BOOLEAN DEFAULT FALSE
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_avatar_history_user_id ON avatar_history(user_id);
CREATE INDEX IF NOT EXISTS idx_avatar_history_uploaded_at ON avatar_history(user_id, uploaded_at DESC);

-- Function to add avatar to history when profile is updated
CREATE OR REPLACE FUNCTION add_avatar_to_history()
RETURNS TRIGGER AS $$
BEGIN
    -- Only add to history if avatar_url changed and is not null
    IF NEW.avatar_url IS NOT NULL AND (OLD.avatar_url IS NULL OR NEW.avatar_url != OLD.avatar_url) THEN
        -- Mark all previous avatars as not current
        UPDATE avatar_history
        SET is_current = FALSE
        WHERE user_id = NEW.id;

        -- Add new avatar to history
        INSERT INTO avatar_history (user_id, avatar_url, is_current)
        VALUES (NEW.id, NEW.avatar_url, TRUE);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically add avatars to history
DROP TRIGGER IF EXISTS trigger_add_avatar_to_history ON users;
CREATE TRIGGER trigger_add_avatar_to_history
    AFTER UPDATE OF avatar_url ON users
    FOR EACH ROW
    EXECUTE FUNCTION add_avatar_to_history();

-- RPC function to get avatar history for a user
CREATE OR REPLACE FUNCTION get_avatar_history(user_uuid UUID)
RETURNS TABLE (
    id UUID,
    avatar_url TEXT,
    uploaded_at TIMESTAMP WITH TIME ZONE,
    is_current BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ah.id,
        ah.avatar_url,
        ah.uploaded_at,
        ah.is_current
    FROM avatar_history ah
    WHERE ah.user_id = user_uuid
    ORDER BY ah.uploaded_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC function to delete an avatar from history
CREATE OR REPLACE FUNCTION delete_avatar_from_history(avatar_id UUID, requesting_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    avatar_user_id UUID;
    avatar_url_to_delete TEXT;
    is_current_avatar BOOLEAN;
    prev_avatar_url TEXT;
BEGIN
    -- Get the avatar details
    SELECT user_id, avatar_url, is_current
    INTO avatar_user_id, avatar_url_to_delete, is_current_avatar
    FROM avatar_history
    WHERE id = avatar_id;

    -- Check if avatar exists
    IF avatar_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Check if requesting user owns this avatar
    IF avatar_user_id != requesting_user_id THEN
        RETURN FALSE;
    END IF;

    -- Delete the avatar from history
    DELETE FROM avatar_history WHERE id = avatar_id;

    -- If this was the current avatar, update profile to use previous avatar
    IF is_current_avatar THEN
        -- Get the most recent remaining avatar
        SELECT avatar_url INTO prev_avatar_url
        FROM avatar_history
        WHERE user_id = avatar_user_id
        ORDER BY uploaded_at DESC
        LIMIT 1;

        -- Update user (this will trigger the history function, but it won't duplicate since URL is same)
        UPDATE users
        SET avatar_url = prev_avatar_url
        WHERE id = avatar_user_id;

        -- Mark the previous avatar as current
        IF prev_avatar_url IS NOT NULL THEN
            UPDATE avatar_history
            SET is_current = TRUE
            WHERE user_id = avatar_user_id AND avatar_url = prev_avatar_url;
        END IF;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Migrate existing avatars to history
INSERT INTO avatar_history (user_id, avatar_url, is_current)
SELECT id, avatar_url, TRUE
FROM users
WHERE avatar_url IS NOT NULL
ON CONFLICT DO NOTHING;
