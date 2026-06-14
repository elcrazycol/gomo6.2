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
