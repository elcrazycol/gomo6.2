package handlers

import (
	"context"
	"crypto/rand"
	"crypto/sha1"
	"database/sql"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gomo6/backend/internal/auth"
	"github.com/redis/go-redis/v9"
)

type AuthHandler struct {
	db          *sql.DB
	authService *auth.AuthService
	redis       *redis.Client // optional — enables lockout and token blacklist
}

func NewAuthHandler(db *sql.DB) *AuthHandler {
	return &AuthHandler{
		db:          db,
		authService: auth.NewAuthService(),
	}
}

// SetRedis enables optional Redis-backed features: lockout, token blacklist.
func (h *AuthHandler) SetRedis(rdb *redis.Client) {
	h.redis = rdb
	h.authService.SetRedis(rdb)
}

// ─── Internal helpers shared across auth modules ─────────────────────────────

// recordFailedAttempt increments the failed login counter in Redis.
func (h *AuthHandler) recordFailedAttempt(email string) {
	if h.redis == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	lockKey := fmt.Sprintf("lockout:%s", email)
	h.redis.Incr(ctx, lockKey)
	h.redis.Expire(ctx, lockKey, 15*time.Minute)
}

// maxAuthActionAttempts bounds wrong-password/wrong-code guesses on sensitive
// authenticated endpoints (password change, 2FA setup/disable). These endpoints
// are password oracles for a session holder, so they need the same per-account
// throttle as the login path — keyed by user ID, not IP, because the attacker
// uses a fixed stolen session.
const maxAuthActionAttempts = 5

// isAuthActionLocked reports whether the per-account throttle for sensitive
// auth actions has been exhausted.
func (h *AuthHandler) isAuthActionLocked(userID string) bool {
	if h.redis == nil {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	n, err := h.redis.Get(ctx, fmt.Sprintf("auth_action_lock:%s", userID)).Int()
	return err == nil && n >= maxAuthActionAttempts
}

// recordAuthActionFailure increments the per-account counter.
func (h *AuthHandler) recordAuthActionFailure(userID string) {
	if h.redis == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	key := fmt.Sprintf("auth_action_lock:%s", userID)
	h.redis.Incr(ctx, key)
	h.redis.Expire(ctx, key, 15*time.Minute)
}

// clearAuthActionLock resets the counter after a successful verification.
func (h *AuthHandler) clearAuthActionLock(userID string) {
	if h.redis == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	h.redis.Del(ctx, fmt.Sprintf("auth_action_lock:%s", userID))
}

// randomHex generates a random hex string of the given length.
func randomHex(length int) string {
	b := make([]byte, (length+1)/2)
	rand.Read(b)
	hexStr := hex.EncodeToString(b)
	if len(hexStr) > length {
		return hexStr[:length]
	}
	return hexStr
}

// isPwned checks a password against the HIBP k-anonymity API.
// Only the first 5 hex chars of the SHA-1 hash are sent over the network.
// Returns true if the password appears in any known data breach.
func isPwned(password string) bool {
	hash := sha1.Sum([]byte(password))
	hashHex := strings.ToUpper(hex.EncodeToString(hash[:]))
	prefix := hashHex[:5]
	suffix := hashHex[5:]

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET",
		"https://api.pwnedpasswords.com/range/"+prefix, nil)
	if err != nil {
		return false // fail open: don't block registration on network errors
	}
	req.Header.Set("Add-Padding", "true") // HIBP padding for extra privacy

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false // fail open
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return false
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return false
	}

	// Each line is "<suffix>:<count>"
	for _, line := range strings.Split(string(body), "\n") {
		if strings.HasPrefix(line, suffix) {
			return true
		}
	}

	return false
}
