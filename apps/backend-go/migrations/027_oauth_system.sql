-- OAuth 2.0 + OpenID Connect system
-- Developer applications
CREATE TABLE IF NOT EXISTS oauth_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    client_id VARCHAR(64) UNIQUE NOT NULL,
    client_secret_hash VARCHAR(255) NOT NULL,
    redirect_uris JSONB NOT NULL DEFAULT '[]'::jsonb,
    allowed_scopes TEXT[] DEFAULT '{profile}'::text[],
    is_confidential BOOLEAN DEFAULT true,
    logo_url TEXT DEFAULT '',
    homepage_url TEXT DEFAULT '',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Authorization codes (short-lived, single-use)
CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(128) UNIQUE NOT NULL,
    client_id VARCHAR(64) NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    redirect_uri TEXT NOT NULL,
    code_challenge TEXT DEFAULT '',
    code_challenge_method VARCHAR(10) DEFAULT '',
    scopes TEXT[] DEFAULT '{}'::text[],
    nonce TEXT DEFAULT '',
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Access tokens (JWT, tracked for revocation)
CREATE TABLE IF NOT EXISTS oauth_access_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_id VARCHAR(64) UNIQUE NOT NULL,
    client_id VARCHAR(64) NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scopes TEXT[] DEFAULT '{}'::text[],
    expires_at TIMESTAMPTZ NOT NULL,
    revoked BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Refresh tokens (opaque, stored as hash)
CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash VARCHAR(255) UNIQUE NOT NULL,
    client_id VARCHAR(64) NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_token_id UUID REFERENCES oauth_access_tokens(id) ON DELETE SET NULL,
    scopes TEXT[] DEFAULT '{}'::text[],
    expires_at TIMESTAMPTZ NOT NULL,
    revoked BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_oauth_apps_owner ON oauth_applications(owner_id);
CREATE INDEX IF NOT EXISTS idx_oauth_apps_client ON oauth_applications(client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_codes_code ON oauth_authorization_codes(code);
CREATE INDEX IF NOT EXISTS idx_oauth_codes_client ON oauth_authorization_codes(client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_token_id ON oauth_access_tokens(token_id);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_client ON oauth_access_tokens(client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user ON oauth_access_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_hash ON oauth_refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_client ON oauth_refresh_tokens(client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_user ON oauth_refresh_tokens(user_id);