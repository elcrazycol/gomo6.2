-- Profile customization table
CREATE TABLE IF NOT EXISTS profile_customization (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    theme_color VARCHAR(7) DEFAULT '#000000',
    background_color VARCHAR(7) DEFAULT '#ffffff',
    card_background VARCHAR(7) DEFAULT '#f8f9fa',
    text_color VARCHAR(7) DEFAULT '#000000',
    custom_css TEXT,
    layout_type VARCHAR(20) DEFAULT 'default',
    font_family VARCHAR(50) DEFAULT 'system-ui',
    font_size INTEGER DEFAULT 16,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_profile_customization_user_id ON profile_customization(user_id);

-- Insert default customization for existing users
INSERT INTO profile_customization (user_id)
SELECT id FROM users 
WHERE id NOT IN (SELECT user_id FROM profile_customization);
