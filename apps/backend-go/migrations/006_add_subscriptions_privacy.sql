-- Thread subscriptions table
CREATE TABLE IF NOT EXISTS thread_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Privacy settings table
CREATE TABLE IF NOT EXISTS privacy_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    remove_image_metadata BOOLEAN DEFAULT false,
    hide_profile_from_search BOOLEAN DEFAULT false,
    allow_direct_messages BOOLEAN DEFAULT true,
    show_online_status BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_thread_subscriptions_user_id ON thread_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_thread_subscriptions_thread_id ON thread_subscriptions(thread_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_thread_subscriptions_unique ON thread_subscriptions(user_id, thread_id);

-- Insert default privacy settings for existing users
INSERT INTO privacy_settings (user_id)
SELECT id FROM users 
WHERE id NOT IN (SELECT user_id FROM privacy_settings);
