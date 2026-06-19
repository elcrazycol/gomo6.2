-- Drop bot system tables (from migrations 017, 033)
DROP TRIGGER IF EXISTS trigger_limit_bot_logs ON bot_logs;
DROP TRIGGER IF EXISTS trigger_update_bot_updated_at ON bots;
DROP FUNCTION IF EXISTS cleanup_old_bot_logs();
DROP FUNCTION IF EXISTS limit_bot_logs_per_bot();
DROP FUNCTION IF EXISTS update_bot_updated_at();
DROP TABLE IF EXISTS bot_stats;
DROP TABLE IF EXISTS bot_logs;
DROP TABLE IF EXISTS bots;
