CREATE TABLE IF NOT EXISTS client_errors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(64) NOT NULL DEFAULT 'unknown',
    message TEXT NOT NULL DEFAULT '',
    stack TEXT,
    url TEXT,
    user_agent TEXT,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_errors_created_at ON client_errors(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_errors_type ON client_errors(type);
