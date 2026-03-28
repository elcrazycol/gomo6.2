-- Удаляем доски /tech/ и /g/
DELETE FROM boards WHERE slug IN ('tech', 'g');