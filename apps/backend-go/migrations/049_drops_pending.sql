-- Drops pending payments tracking table

CREATE TABLE IF NOT EXISTS drops_pending (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    drops_amount INTEGER NOT NULL,
    price_usd DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'initiated'
        CHECK (status IN ('initiated', 'callback_received', 'credited', 'expired')),
    blockchain VARCHAR(50),
    tx_hash VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    credited_at TIMESTAMPTZ
);

CREATE INDEX idx_drops_pending_user ON drops_pending(user_id, status, created_at DESC);
CREATE INDEX idx_drops_pending_stale ON drops_pending(status, created_at) WHERE status = 'initiated';
