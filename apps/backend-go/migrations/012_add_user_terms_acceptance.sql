-- User terms acceptance table
CREATE TABLE IF NOT EXISTS user_terms_acceptance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    terms_version VARCHAR(50) NOT NULL DEFAULT '1.0',
    accepted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id)
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_user_terms_acceptance_user_id ON user_terms_acceptance(user_id);

-- Insert default acceptance for existing users
INSERT INTO user_terms_acceptance (user_id)
SELECT id FROM users 
WHERE id NOT IN (SELECT user_id FROM user_terms_acceptance);
