-- Add "Раб Нейросети" achievement
INSERT INTO achievements (id, name, description, icon, category, reward_type, reward_value) VALUES
('ai_user', 'Раб Нейросети', 'Использовал нейросеть gomo6', '🤖', 'ai', NULL, NULL)
ON CONFLICT (id) DO NOTHING;