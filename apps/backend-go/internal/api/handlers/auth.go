package handlers

import (
	"context"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/search"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"
)

type AuthHandler struct {
	db            *sql.DB
	authService   *auth.AuthService
	redis         *redis.Client // optional — enables lockout and token blacklist
	searchIndexer *search.Indexer
	// serviceNotifier delivers login alerts through the @gomo6 thread.
	// Best-effort: failures are swallowed by the notifier itself.
	serviceNotifier func(userID, text string)
}

// SetServiceNotifier injects the login-alert sender (see messenger
// SendServiceNotification). Nil disables the alerts.
func (h *AuthHandler) SetServiceNotifier(fn func(userID, text string)) {
	h.serviceNotifier = fn
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

// SetSearchIndexer injects the best-effort search indexer (nil disables sync).
func (h *AuthHandler) SetSearchIndexer(idx *search.Indexer) { h.searchIndexer = idx }

// ─── Internal helpers shared across auth modules ─────────────────────────────

// recordFailedAttempt increments the failed login counter in Redis. The key
// must be built with normalizeLockoutKey (it already carries the "lockout:"
// prefix).
func (h *AuthHandler) recordFailedAttempt(lockKey string) {
	if h.redis == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	h.redis.Incr(ctx, lockKey)
	h.redis.Expire(ctx, lockKey, 15*time.Minute)
}

// normalizeLockoutKey maps a login identifier to its brute-force counter key.
// Usernames are case-sensitive in the DB, but lockout is a DoS-adjacent
// defense: normalizing case/whitespace keeps "Alice", "alice " and " ALICE"
// on one budget instead of three independent ones.
func normalizeLockoutKey(identifier string) string {
	return "lockout:" + strings.ToLower(strings.TrimSpace(identifier))
}

// dummyPasswordHash is a valid bcrypt hash of an unguessable value, used only
// to equalize Login timing for nonexistent identifiers (see Login). It is
// generated once per process — the ~250ms cost is paid on the first
// nonexistent-user login only, not on startup.
var (
	dummyHashOnce sync.Once
	dummyHash     []byte
)

func dummyPasswordHash() []byte {
	dummyHashOnce.Do(func() {
		h, err := bcrypt.GenerateFromPassword(
			[]byte("gomo6-dummy-timing-mitigation-c6f9a1e4b2d8"), bcrypt.DefaultCost)
		if err == nil {
			dummyHash = h
		}
	})
	return dummyHash
}

// dummyPasswordCompare burns ~the same CPU as a real password check so the
// nonexistent-user path (instant 401) is indistinguishable in timing from the
// wrong-password path (bcrypt ~250ms). Without it, response time alone
// enumerates registered usernames/emails.
func dummyPasswordCompare(password string) {
	if h := dummyPasswordHash(); h != nil {
		_ = bcrypt.CompareHashAndPassword(h, []byte(password))
	}
}

// ─── Password hashing ────────────────────────────────────────────────────────
// bcrypt truncates inputs at 72 bytes, so a naive bcrypt(password) silently
// equates all long passwords sharing a 72-byte prefix. Every password is
// SHA-256 pre-hashed (hex) before bcrypt — the same scheme as OAuth client
// secrets (oauth.HashClientSecret) — so passphrases of any length keep their
// full entropy. Cost 12 (~250ms) matches the existing login budget.
func hashPassword(password string) (string, error) {
	sum := sha256.Sum256([]byte(password))
	prehashed := hex.EncodeToString(sum[:])
	h, err := bcrypt.GenerateFromPassword([]byte(prehashed), 12)
	if err != nil {
		return "", err
	}
	return string(h), nil
}

// verifyPassword checks a password against a stored hash. New hashes use the
// SHA-256 pre-hash scheme; legacy rows (plain bcrypt, created before the
// migration) are still accepted so existing users keep logging in — Login
// transparently re-hashes them to the new scheme on success.
func verifyPassword(storedHash, password string) error {
	sum := sha256.Sum256([]byte(password))
	prehashed := hex.EncodeToString(sum[:])
	if err := bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(prehashed)); err == nil {
		return nil
	}
	// Legacy fallback: plain bcrypt(password). Only reached for old rows.
	return bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(password))
}

// isLegacyPasswordHash reports whether the stored hash verifies ONLY via the
// legacy plain-bcrypt scheme (i.e. the row still needs a transparent upgrade).
func isLegacyPasswordHash(storedHash, password string) bool {
	sum := sha256.Sum256([]byte(password))
	prehashed := hex.EncodeToString(sum[:])
	if bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(prehashed)) == nil {
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(password)) == nil
}

// authTokensResponse builds the login/register JSON payload. The access token
// is returned for the in-memory Bearer compatibility path; the refresh token
// is returned ONLY for cookieless API clients that explicitly opt in via
// include_tokens. Browser flows keep it false, so page JS (and any XSS) can
// never harvest the long-lived session from a response body — it travels in
// the HttpOnly cookie set by SetAuthCookies.
func authTokensResponse(pair *auth.TokenPair, user models.User, includeTokens bool) gin.H {
	resp := gin.H{
		"user":       user,
		"token":      pair.AccessToken,
		"expires_in": pair.ExpiresIn,
	}
	if includeTokens {
		resp["refresh_token"] = pair.RefreshToken
	}
	return resp
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
	return isAuthActionLockedRDB(h.redis, userID)
}

// recordAuthActionFailure increments the per-account counter.
func (h *AuthHandler) recordAuthActionFailure(userID string) {
	recordAuthActionFailureRDB(h.redis, userID)
}

// clearAuthActionLock resets the counter after a successful verification.
func (h *AuthHandler) clearAuthActionLock(userID string) {
	clearAuthActionLockRDB(h.redis, userID)
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
