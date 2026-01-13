-- Add metadata removal setting to privacy_settings table
ALTER TABLE privacy_settings
ADD COLUMN IF NOT EXISTS remove_image_metadata BOOLEAN DEFAULT true;

-- Update existing records to have metadata removal enabled by default
UPDATE privacy_settings
SET remove_image_metadata = true
WHERE remove_image_metadata IS NULL;