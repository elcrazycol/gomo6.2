-- Auto-cleanup old bot logs (keep only last 7 days)

-- Function to delete old bot logs
CREATE OR REPLACE FUNCTION cleanup_old_bot_logs()
RETURNS void AS $$
BEGIN
    DELETE FROM bot_logs
    WHERE created_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- Create a scheduled job to run cleanup daily (using pg_cron if available)
-- If pg_cron is not available, this can be run manually or via a cron job

-- Alternative: Add a trigger to limit logs per bot (keep only last 1000 logs per bot)
CREATE OR REPLACE FUNCTION limit_bot_logs_per_bot()
RETURNS TRIGGER AS $$
BEGIN
    -- Delete old logs if bot has more than 1000 logs
    DELETE FROM bot_logs
    WHERE id IN (
        SELECT id FROM bot_logs
        WHERE bot_id = NEW.bot_id
        ORDER BY created_at DESC
        OFFSET 1000
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to run after each insert
DROP TRIGGER IF EXISTS trigger_limit_bot_logs ON bot_logs;
CREATE TRIGGER trigger_limit_bot_logs
    AFTER INSERT ON bot_logs
    FOR EACH ROW
    EXECUTE FUNCTION limit_bot_logs_per_bot();

-- Add index for faster cleanup
CREATE INDEX IF NOT EXISTS idx_bot_logs_created_at_bot_id ON bot_logs(bot_id, created_at DESC);

-- Manual cleanup of old logs (run once)
DELETE FROM bot_logs WHERE created_at < NOW() - INTERVAL '7 days';
