-- User sessions tracking for device/session management
CREATE TABLE IF NOT EXISTS user_sessions (
    id VARCHAR(64) PRIMARY KEY,              -- SHA-256 hex hash of refresh token
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_agent TEXT NOT NULL DEFAULT '',       -- raw User-Agent string
    os_name VARCHAR(64) NOT NULL DEFAULT '',  -- parsed: macOS, Windows, iOS, Android
    browser_name VARCHAR(64) NOT NULL DEFAULT '', -- parsed: Chrome, Safari, Firefox
    device_type VARCHAR(16) NOT NULL DEFAULT 'desktop', -- desktop/mobile/tablet
    ip_address INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_last_active ON user_sessions(last_active_at DESC);
