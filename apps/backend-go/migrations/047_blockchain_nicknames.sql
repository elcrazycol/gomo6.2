-- 047_blockchain_nicknames.sql
-- Blockchain wallet and nickname tables for Base L2 integration.

CREATE TABLE IF NOT EXISTS user_wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    wallet_address VARCHAR(42) NOT NULL UNIQUE,
    smart_wallet_address VARCHAR(42),
    public_key BYTEA,
    chain_id INTEGER NOT NULL DEFAULT 8453,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_nicknames (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nickname VARCHAR(32) NOT NULL UNIQUE,
    token_id VARCHAR(78) NOT NULL UNIQUE,
    contract_address VARCHAR(42) NOT NULL,
    is_primary BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nickname_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nickname VARCHAR(32) NOT NULL,
    from_user_id UUID REFERENCES users(id),
    to_user_id UUID REFERENCES users(id),
    from_address VARCHAR(42) NOT NULL,
    to_address VARCHAR(42) NOT NULL,
    tx_hash VARCHAR(66) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_wallets_user ON user_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_user_wallets_address ON user_wallets(wallet_address);
CREATE INDEX IF NOT EXISTS idx_user_nicknames_user ON user_nicknames(user_id);
CREATE INDEX IF NOT EXISTS idx_user_nicknames_name ON user_nicknames(nickname);
CREATE INDEX IF NOT EXISTS idx_nickname_transfers_nickname ON nickname_transfers(nickname);
