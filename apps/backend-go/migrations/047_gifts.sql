-- Gift system: catalog + user gifts

CREATE TABLE IF NOT EXISTS gift_catalog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    image_url TEXT NOT NULL,
    price INTEGER NOT NULL CHECK (price > 0),
    category VARCHAR(100) DEFAULT 'general',
    is_active BOOLEAN DEFAULT TRUE,
    is_limited BOOLEAN DEFAULT FALSE,
    max_quantity INTEGER,
    sold_count INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_gifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gift_id UUID NOT NULL REFERENCES gift_catalog(id),
    sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
    recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message TEXT,
    is_anonymous BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_gifts_recipient ON user_gifts(recipient_id);
CREATE INDEX IF NOT EXISTS idx_user_gifts_sender ON user_gifts(sender_id);
CREATE INDEX IF NOT EXISTS idx_gift_catalog_active ON gift_catalog(is_active, sort_order);
