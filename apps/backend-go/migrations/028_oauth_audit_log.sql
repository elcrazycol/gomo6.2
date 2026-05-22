-- OAuth Audit Log
-- Tracks all OAuth operations: authorization, token exchange, refresh, revocation,
-- and developer panel actions (app creation, updates, deletion, secret regeneration)
CREATE TABLE IF NOT EXISTS oauth_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    client_id VARCHAR(64),
    app_name VARCHAR(255),
    action VARCHAR(50) NOT NULL,
    details JSONB DEFAULT '{}'::jsonb,
    ip_address VARCHAR(45) DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_oauth_audit_user ON oauth_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_audit_client ON oauth_audit_log(client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_audit_action ON oauth_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_oauth_audit_created ON oauth_audit_log(created_at DESC);
