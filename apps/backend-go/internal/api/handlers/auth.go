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

// randRead is the crypto/rand seam. Tests replace it to exercise the failure
// path; production code must never assign it.
var randRead = rand.Read

// base36Alphabet is used for wallet addresses, whose format is fixed by the
// users.wallet_address column (VARCHAR(14)) and the client-side regex.
const base36Alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"

// randomHex generates a random hex string of the given length.
//
// It PANICS when the system CSPRNG fails rather than degrading to a predictable
// value: these bytes back session tokens, 2FA recovery codes and bot passwords,
// so the previous silent fallback (a zero-filled buffer → "0000…") could have
// minted guessable credentials. A CSPRNG failure means the process cannot safely
// serve requests; gin.Recovery turns the panic into a 500.
func randomHex(length int) string {
	return mustRandom(secureHex(length))
}

// randomBase36 generates length characters from a 36-symbol alphabet.
//
// Wallet addresses are pinned to "GM6-XXXX-XXXX" by the DB column (VARCHAR(14))
// and the frontend regex, so widening the address space means using the full
// alphabet instead of hex — 32 bits → ~41 bits — not lengthening the string.
func randomBase36(length int) string {
	return mustRandom(secureBase36(length))
}

func mustRandom(s string, err error) string {
	if err != nil {
		panic(fmt.Sprintf("crypto/rand unavailable: %v", err))
	}
	return s
}

// secureHex returns length lowercase hex characters, or an error when the
// CSPRNG is unavailable.
func secureHex(length int) (string, error) {
	if length <= 0 {
		return "", fmt.Errorf("secureHex: length must be positive, got %d", length)
	}
	b := make([]byte, (length+1)/2)
	if _, err := randRead(b); err != nil {
		return "", fmt.Errorf("crypto/rand: %w", err)
	}
	return hex.EncodeToString(b)[:length], nil
}

// secureBase36 returns length characters from base36Alphabet, drawn without
// modulo bias (256 is not a multiple of 36, so the byte tail is rejected).
func secureBase36(length int) (string, error) {
	if length <= 0 {
		return "", fmt.Errorf("secureBase36: length must be positive, got %d", length)
	}
	const limit = 256 - (256 % 36) // 252
	out := make([]byte, 0, length)
	buf := make([]byte, length)
	for len(out) < length {
		if _, err := randRead(buf); err != nil {
			return "", fmt.Errorf("crypto/rand: %w", err)
		}
		for _, b := range buf {
			if int(b) >= limit {
				continue
			}
			out = append(out, base36Alphabet[int(b)%36])
			if len(out) == length {
				break
			}
		}
	}
	return string(out), nil
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
