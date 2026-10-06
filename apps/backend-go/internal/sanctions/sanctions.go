// Package sanctions holds the platform-sanction model (warn / mute / ban) and
// the lookups the enforcement points share.
//
// Enforcement is centralised:
//   - the sanction gate middleware blocks non-GET requests for an active mute
//     or ban (moderators/admins bypass);
//   - the login handler refuses a ban.
//
// The blocking lookup is cached in Redis for a minute and invalidated on every
// apply/revoke, so the gate does not hit the database on every write. A Redis
// miss or error always falls through to the database — enforcement never fails
// open.
package sanctions

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"github.com/redis/go-redis/v9"
)

// Kind is a sanction type.
type Kind string

const (
	KindWarn Kind = "warn" // recorded warning, never blocks
	KindMute Kind = "mute" // may read, may not create content
	KindBan  Kind = "ban"  // mute + login refused
)

// Valid reports whether k is a known sanction kind.
func (k Kind) Valid() bool {
	switch k {
	case KindWarn, KindMute, KindBan:
		return true
	}
	return false
}

// Blocking reports whether the kind restricts writing.
func (k Kind) Blocking() bool { return k == KindMute || k == KindBan }

// Active is an active blocking sanction.
type Active struct {
	Kind      Kind       `json:"kind"`
	Reason    string     `json:"reason"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
}

const (
	blockCachePrefix = "sanctions:block:"
	blockCacheTTL    = time.Minute
)

func blockCacheKey(userID string) string { return blockCachePrefix + userID }

// ActiveBlocking returns the user's active mute/ban, or nil. A ban is preferred
// over a mute when both are active.
func ActiveBlocking(ctx context.Context, db *sql.DB, userID string) (*Active, error) {
	if db == nil || userID == "" {
		return nil, nil
	}
	var (
		kind      string
		reason    string
		expiresAt sql.NullTime
	)
	err := db.QueryRowContext(ctx, `
		SELECT kind, reason, expires_at
		FROM user_sanctions
		WHERE user_id = $1
		  AND kind IN ('mute', 'ban')
		  AND revoked_at IS NULL
		  AND (expires_at IS NULL OR expires_at > NOW())
		ORDER BY (kind = 'ban') DESC, created_at DESC
		LIMIT 1`, userID).Scan(&kind, &reason, &expiresAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	a := &Active{Kind: Kind(kind), Reason: reason}
	if expiresAt.Valid {
		t := expiresAt.Time
		a.ExpiresAt = &t
	}
	return a, nil
}

// InvalidateBlockCache drops the cached blocking sanction of a user. Call after
// applying or revoking a sanction so the gate sees it immediately.
func InvalidateBlockCache(ctx context.Context, redisClient *redis.Client, userID string) {
	if redisClient == nil || userID == "" {
		return
	}
	redisClient.Del(ctx, blockCacheKey(userID))
}

// ActiveBlockingCached is ActiveBlocking behind a short Redis cache. An empty
// cached value means "no blocking sanction".
func ActiveBlockingCached(ctx context.Context, db *sql.DB, redisClient *redis.Client, userID string) *Active {
	if db == nil || userID == "" {
		return nil
	}
	if redisClient != nil {
		if raw, err := redisClient.Get(ctx, blockCacheKey(userID)).Result(); err == nil {
			if raw == "" {
				return nil
			}
			var a Active
			if json.Unmarshal([]byte(raw), &a) == nil {
				return &a
			}
		}
	}
	a, err := ActiveBlocking(ctx, db, userID)
	if err != nil {
		return nil
	}
	if redisClient != nil {
		payload := ""
		if a != nil {
			if b, err := json.Marshal(a); err == nil {
				payload = string(b)
			}
		}
		redisClient.Set(ctx, blockCacheKey(userID), payload, blockCacheTTL)
	}
	return a
}
