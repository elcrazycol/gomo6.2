-- Drops virtual currency system

ALTER TABLE users ADD COLUMN IF NOT EXISTS drops INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS drops_packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    drops_amount INTEGER NOT NULL,
    price_usd DECIMAL(10,2) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS drops_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL,
    amount INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    reference_id UUID,
    reference_type VARCHAR(50),
    description TEXT,
    blockchain VARCHAR(50),
    tx_hash VARCHAR(255) UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drops_tx_user ON drops_transactions(user_id, created_at DESC);

-- Seed default packages
INSERT INTO drops_packages (name, drops_amount, price_usd, sort_order) VALUES
    ('Стартовый', 50, 1.99, 1),
    ('Стандарт', 200, 5.99, 2),
    ('Большой', 500, 12.99, 3),
    ('Супер', 1500, 29.99, 4)
ON CONFLICT DO NOTHING;
