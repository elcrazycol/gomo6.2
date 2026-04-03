-- User placeholders table for profile customization
CREATE TABLE IF NOT EXISTS user_placeholders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    placeholder_type VARCHAR(50) NOT NULL, -- 'bio', 'status', 'avatar_text', etc.
    placeholder_text TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_user_placeholders_user_id ON user_placeholders(user_id);
CREATE INDEX IF NOT EXISTS idx_user_placeholders_type ON user_placeholders(placeholder_type);

-- Insert default placeholders for existing users
INSERT INTO user_placeholders (user_id, placeholder_type, placeholder_text)
SELECT 
    id as user_id,
    'bio' as placeholder_type,
    'Расскажите о себе...' as placeholder_text
FROM users 
WHERE id NOT IN (SELECT user_id FROM user_placeholders WHERE placeholder_type = 'bio');

INSERT INTO user_placeholders (user_id, placeholder_type, placeholder_text)
SELECT 
    id as user_id,
    'status' as placeholder_type,
    'Как ваше настроение?' as placeholder_text
FROM users 
WHERE id NOT IN (SELECT user_id FROM user_placeholders WHERE placeholder_type = 'status');
