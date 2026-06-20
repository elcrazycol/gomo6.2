ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_address VARCHAR(14) UNIQUE;

-- Backfill: single UPDATE, no PL/pgSQL loops
UPDATE users
SET wallet_address = 'GM6-' ||
    UPPER(SUBSTRING(MD5(id::text || random()::text) FROM 1 FOR 4)) || '-' ||
    UPPER(SUBSTRING(MD5(id::text || random()::text) FROM 5 FOR 4))
WHERE wallet_address IS NULL;

ALTER TABLE users ALTER COLUMN wallet_address SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_wallet_address ON users(wallet_address);
