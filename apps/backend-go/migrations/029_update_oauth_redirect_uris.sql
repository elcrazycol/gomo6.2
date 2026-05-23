-- Migration 029: Update OAuth redirect_uris from old port-based URLs to subdomain-based URLs
--
-- После перехода на Docker с Caddy все сервисы работают через единый порт 80.
-- Старые портовые URL в redirect_uris OAuth-приложений нужно заменить на субдоменные.
--
-- Маппинг портов → субдомены:
--   :3002 / :8082  →  dev.localhost    (dev-dashboard)
--   :3001           →  docs.localhost   (документация)
--   :8080 / :8081   →  localhost       (основной сайт)
--
-- Пример: ["http://localhost:3002/callback","http://localhost:8082/callback"]
--       → ["http://dev.localhost/callback","http://dev.localhost/callback"]

-- Вспомогательная функция: заменяет портовый URL на субдоменный внутри JSONB-массива
CREATE OR REPLACE FUNCTION _migrate_oauth_redirect_uri(uri TEXT)
RETURNS TEXT AS $$
BEGIN
    -- dev-dashboard: :3002 или :8082 → dev.localhost
    -- (также http://dev.localhost:3002 → http://dev.localhost)
    IF uri ~ '^https?://(dev\.)?localhost:(3002|8082)(/|$)' THEN
        RETURN regexp_replace(uri, '^https?://(dev\.)?localhost:(3002|8082)', 'http://dev.localhost');
    END IF;
    -- docs: :3001 → docs.localhost
    IF uri ~ '^https?://localhost:3001(/|$)' THEN
        RETURN regexp_replace(uri, '^https?://localhost:3001', 'http://docs.localhost');
    END IF;
    -- main site: :8080 или :8081 → localhost
    IF uri ~ '^https?://localhost:808[01](/|$)' THEN
        RETURN regexp_replace(uri, '^https?://localhost:808[01]', 'http://localhost');
    END IF;
    RETURN uri;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Обновляем redirect_uris во всех приложениях, где есть портовые URL
-- COALESCE защищает от NULL при jsonb_agg над пустым массивом
UPDATE oauth_applications
SET redirect_uris = COALESCE(
    (
        SELECT jsonb_agg(_migrate_oauth_redirect_uri(value))
        FROM jsonb_array_elements_text(redirect_uris) AS value
    ),
    '[]'::jsonb
),
    updated_at = NOW()
WHERE redirect_uris::text ~ 'localhost:[0-9]';

-- Обновляем homepage_url (текстовое поле с одним значением)
UPDATE oauth_applications
SET homepage_url = CASE
        WHEN homepage_url ~ '^https?://localhost:(3002|8082)(/|$)' THEN
            regexp_replace(homepage_url, '^https?://localhost:(3002|8082)', 'http://dev.localhost')
        WHEN homepage_url ~ '^https?://localhost:3001(/|$)' THEN
            regexp_replace(homepage_url, '^https?://localhost:3001', 'http://docs.localhost')
        WHEN homepage_url ~ '^https?://localhost:808[01](/|$)' THEN
            regexp_replace(homepage_url, '^https?://localhost:808[01]', 'http://localhost')
        ELSE homepage_url
    END,
    updated_at = NOW()
WHERE homepage_url ~ 'localhost:[0-9]';

-- Обновляем logo_url (текстовое поле с одним значением)
UPDATE oauth_applications
SET logo_url = CASE
        WHEN logo_url ~ '^https?://localhost:(3002|8082)(/|$)' THEN
            regexp_replace(logo_url, '^https?://localhost:(3002|8082)', 'http://dev.localhost')
        WHEN logo_url ~ '^https?://localhost:3001(/|$)' THEN
            regexp_replace(logo_url, '^https?://localhost:3001', 'http://docs.localhost')
        WHEN logo_url ~ '^https?://localhost:808[01](/|$)' THEN
            regexp_replace(logo_url, '^https?://localhost:808[01]', 'http://localhost')
        ELSE logo_url
    END,
    updated_at = NOW()
WHERE logo_url ~ 'localhost:[0-9]';

-- Удаляем вспомогательную функцию
DROP FUNCTION IF EXISTS _migrate_oauth_redirect_uri;
