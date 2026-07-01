-- Gift upgrade system: layered composable gifts
-- Each upgradable gift can have multiple layers (gift image, background, symbol)
-- When upgraded, a random combination of layers is assigned permanently

-- 1. Add upgrade columns to gift_catalog
ALTER TABLE gift_catalog
  ADD COLUMN IF NOT EXISTS is_upgradable BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS upgrade_cost INTEGER DEFAULT NULL;

-- 2. Create gift_layers table for composable gift parts
CREATE TABLE IF NOT EXISTS gift_layers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gift_catalog_id UUID NOT NULL REFERENCES gift_catalog(id) ON DELETE CASCADE,
    layer_type VARCHAR(20) NOT NULL CHECK (layer_type IN ('gift', 'background', 'symbol')),
    image_url TEXT NOT NULL,
    name VARCHAR(255),
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gift_layers_catalog ON gift_layers(gift_catalog_id);
CREATE INDEX IF NOT EXISTS idx_gift_layers_type ON gift_layers(gift_catalog_id, layer_type);

-- 3. Add upgrade tracking and FK constraints to user_gifts
ALTER TABLE user_gifts
  ADD COLUMN IF NOT EXISTS is_upgraded BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS gift_layer_id UUID REFERENCES gift_layers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS background_layer_id UUID REFERENCES gift_layers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS symbol_layer_id UUID REFERENCES gift_layers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS upgraded_at TIMESTAMPTZ;
