-- Follow/subscription social graph.
--
-- The base relation becomes one-directional: you subscribe to a user, no
-- approval needed. A friendship is then simply a MUTUAL subscription. The
-- existing `friendships` table is kept as the materialized form of that mutual
-- pair so every consumer (profile privacy, walls, messenger, feed ranking,
-- realtime WS room gates) keeps working unchanged.
--
-- Migration: 131_subscriptions.sql

CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscriber_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (subscriber_id, target_id),
    CHECK (subscriber_id <> target_id)
);

CREATE INDEX idx_subscriptions_target ON subscriptions(target_id);
CREATE INDEX idx_subscriptions_subscriber ON subscriptions(subscriber_id);

-- Backfill from the legacy friend graph:
--   * every existing friendship becomes two mutual subscriptions;
--   * every still-pending friend request becomes a one-directional subscription
--     (the sender follows the receiver, exactly what they were asking for).
INSERT INTO subscriptions (subscriber_id, target_id)
SELECT user1_id, user2_id FROM friendships
ON CONFLICT (subscriber_id, target_id) DO NOTHING;

INSERT INTO subscriptions (subscriber_id, target_id)
SELECT user2_id, user1_id FROM friendships
ON CONFLICT (subscriber_id, target_id) DO NOTHING;

INSERT INTO subscriptions (subscriber_id, target_id)
SELECT sender_id, receiver_id FROM friend_requests WHERE status = 'pending'
ON CONFLICT (subscriber_id, target_id) DO NOTHING;

-- Materialize every mutual pair as a friendship (covers the backfilled rows and
-- repairs any drift). Ordered user1_id < user2_id per the friendships CHECK.
INSERT INTO friendships (user1_id, user2_id)
SELECT LEAST(s1.subscriber_id, s1.target_id), GREATEST(s1.subscriber_id, s1.target_id)
FROM subscriptions s1
JOIN subscriptions s2
  ON s2.subscriber_id = s1.target_id
 AND s2.target_id = s1.subscriber_id
ON CONFLICT (user1_id, user2_id) DO NOTHING;
