-- 108_push_notifications.sql
--
-- Web Push (PWA) support. Two tables:
--
-- push_subscriptions — one row per browser/device the user has enabled push on.
--   - endpoint: the PushManager subscription endpoint (FCM/APNs/WebPush relay).
--   - p256dh / auth: the base64url keys from PushSubscription.getKey(), used by
--     the backend (RFC 8291 aes128gcm) to encrypt the notification payload.
--   - user_agent: device label for the "/devices" management surface.
--   A user may have multiple subscriptions (phone + laptop).
--
-- push_preferences — per-user opt-out of specific notification types. The
-- default (no row) is: every notification type pushes. Rows in this table pin
-- a concrete {type -> enabled} map so the user can disable noisy types while
-- keeping the rest — and edit exactly what they receive from Settings.

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint   TEXT NOT NULL,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS push_preferences (
    user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    -- JSONB map { notification_type: boolean }. Absent keys = enabled. An
    -- empty row (all absent) is equivalent to "no preferences row at all".
    type_map   JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
