package handlers

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/gomo6/backend/internal/auth"
	"github.com/redis/go-redis/v9"
)

// consumeReauthToken burns a passkey re-authentication token for the user.
// Empty token → false (no error): callers treat it as "not provided".
func consumeReauthToken(authSvc *auth.AuthService, userID, token string) bool {
	if authSvc == nil || strings.TrimSpace(token) == "" {
		return false
	}
	return authSvc.ConsumeReauthToken(userID, token) == nil
}

// userHasPasskeys reports whether the account holds at least one passkey.
// DB errors fail closed to true (assume protected): a sensitive action must
// not silently downgrade to session-only proof because of a read error.
func userHasPasskeys(db *sql.DB, userID string) bool {
	if db == nil {
		return true
	}
	var n int
	if err := db.QueryRow(
		`SELECT COUNT(*) FROM user_webauthn_credentials WHERE user_id = $1`, userID,
	).Scan(&n); err != nil {
		return true
	}
	return n > 0
}

// ─── Per-account throttle for sensitive auth actions ─────────────────────────
// Password/code oracles (password change, 2FA setup/disable, passkey delete)
// are keyed by user ID, not IP: the attacker holds a fixed stolen session, so
// IP throttling would not help. Redis-down fails OPEN here only because these
// endpoints already require a valid authenticated session — the pre-auth
// brute-force surface (login/verify-2fa) stays fail-closed via strict limiters.
func authActionLockKey(userID string) string {
	return fmt.Sprintf("auth_action_lock:%s", userID)
}

func isAuthActionLockedRDB(rdb *redis.Client, userID string) bool {
	if rdb == nil {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	n, err := rdb.Get(ctx, authActionLockKey(userID)).Int()
	return err == nil && n >= maxAuthActionAttempts
}

func recordAuthActionFailureRDB(rdb *redis.Client, userID string) {
	if rdb == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	key := authActionLockKey(userID)
	rdb.Incr(ctx, key)
	rdb.Expire(ctx, key, 15*time.Minute)
}

func clearAuthActionLockRDB(rdb *redis.Client, userID string) {
	if rdb == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	rdb.Del(ctx, authActionLockKey(userID))
}
