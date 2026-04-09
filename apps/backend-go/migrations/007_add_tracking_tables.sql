-- Tracking tables required by frontend integrations

CREATE TABLE IF NOT EXISTS user_daily_visits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    visit_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, visit_date)
);

CREATE TABLE IF NOT EXISTS thread_custom_message_visits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    has_custom_message BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, thread_id)
);

CREATE INDEX IF NOT EXISTS idx_user_daily_visits_user_id ON user_daily_visits(user_id);
CREATE INDEX IF NOT EXISTS idx_thread_custom_message_visits_user_id ON thread_custom_message_visits(user_id);
CREATE INDEX IF NOT EXISTS idx_thread_custom_message_visits_thread_id ON thread_custom_message_visits(thread_id);
