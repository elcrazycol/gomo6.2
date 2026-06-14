package handlers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
	"github.com/redis/go-redis/v9"
)

// CaptchaHandler provides anti-bot protection via Proof-of-Work (built-in)
// with optional mCaptcha server integration.
type CaptchaHandler struct {
	redis      *redis.Client
	siteKey    string
	secret     string
	verifyURL  string
	widgetURL  string // base URL of the mCaptcha server (serves widget JS)
	httpClient *http.Client
	// PoW difficulty: number of leading zero bits required in SHA-256 hash.
	// 12 bits = ~4k hashes avg (~50ms on a low-end phone, sub-ms on desktop)
	// 16 bits = ~65k hashes avg (~1–2s on a low-end phone, ~50ms on desktop)
	//
	// Default lowered to 12 so login works on weak devices. Bots still pay
	// meaningful CPU cost at difficulty 12, while real users with old phones
	// or low-end laptops get a sub-100ms experience. Operators who want
	// stronger anti-bot can raise it via MCAPTCHA_POW_DIFFICULTY.
	powDifficulty int
}

// NewCaptchaHandler creates a new CaptchaHandler.
// Reads optional mCaptcha config from env vars:
//
//	MCAPTCHA_SITE_KEY  — public site key (exposed to frontend)
//	MCAPTCHA_SECRET    — secret for backend verification
//	MCAPTCHA_VERIFY_URL — mCaptcha server verification endpoint
//	MCAPTCHA_WIDGET_URL — base URL of the mCaptcha server that serves the
//	                      widget JS bundle (e.g. http://mcaptcha:8080).
//	                      Defaults to derive from MCAPTCHA_VERIFY_URL by
//	                      stripping "/api/v1/pow/verify".
//	MCAPTCHA_POW_DIFFICULTY — PoW difficulty in bits (default: 12, ~4k hashes avg)
//
// If mCaptcha is NOT configured, built-in Proof-of-Work is used as fallback.
func NewCaptchaHandler(redis *redis.Client) *CaptchaHandler {
	difficulty := 12
	if d := os.Getenv("MCAPTCHA_POW_DIFFICULTY"); d != "" {
		if parsed, err := strconv.Atoi(d); err == nil && parsed >= 8 && parsed <= 32 {
			difficulty = parsed
		}
	}

	verifyURL := os.Getenv("MCAPTCHA_VERIFY_URL")
	widgetURL := deriveMCaptchaWidgetURL(os.Getenv("MCAPTCHA_WIDGET_URL"), verifyURL)

	return &CaptchaHandler{
		redis:         redis,
		siteKey:       os.Getenv("MCAPTCHA_SITE_KEY"),
		secret:        os.Getenv("MCAPTCHA_SECRET"),
		verifyURL:     verifyURL,
		widgetURL:     widgetURL,
		httpClient:    &http.Client{Timeout: 10 * time.Second},
		powDifficulty: difficulty,
	}
}

// IsConfigured returns true if external mCaptcha server is configured.
func (h *CaptchaHandler) IsConfigured() bool {
	return h.siteKey != "" && h.secret != "" && h.verifyURL != ""
}

// GetConfig returns CAPTCHA public configuration for the frontend.
// GET /api/v1/auth/captcha-config
func (h *CaptchaHandler) GetConfig(c *gin.Context) {
	if h.IsConfigured() {
		c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
			"type":       "mcaptcha",
			"enabled":    true,
			"site_key":   h.siteKey,
			"widget_url": h.widgetURL,
		}))
		return
	}

	// Built-in PoW requires Redis for challenge storage
	if h.redis == nil {
		c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
			"type":    "pow",
			"enabled": false,
		}))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"type":    "pow",
		"enabled": true,
	}))
}

// ── Challenge-Response Proof-of-Work ───────────────────────────────────────

type powChallenge struct {
	ChallengeID string `json:"challenge_id"`
	Nonce       string `json:"nonce"`      // hex-encoded random bytes
	Difficulty  int    `json:"difficulty"` // number of leading zero bits required
	ExpiresAt   int64  `json:"expires_at"` // unix timestamp (seconds)
	// IssuedAt is server time in milliseconds — useful for client diagnostics.
	IssuedAt int64 `json:"issued_at"`
}

// minPowDifficulty is the lower bound for the PoW difficulty the server will
// ever issue, even if a misbehaving client asks for less. Keeps some anti-bot
// value while still letting weak devices log in.
const minPowDifficulty = 8

// GetChallenge generates a new PoW challenge and stores it in Redis.
// GET /api/v1/auth/captcha-challenge
//
// Optional query params (used by the client to ask for a lower-difficulty
// challenge when its previous attempt timed out — e.g. on a weak device):
//
//	?max_difficulty=10   — cap the issued difficulty to this value
func (h *CaptchaHandler) GetChallenge(c *gin.Context) {
	if h.IsConfigured() {
		// External mCaptcha handles challenge generation client-side
		c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
			"type":    "mcaptcha",
			"message": "Use mCaptcha widget for challenge",
		}))
		return
	}

	// Built-in PoW requires Redis
	if h.redis == nil {
		c.JSON(http.StatusServiceUnavailable, models.ErrorResponse("CAPTCHA service temporarily unavailable"))
		return
	}

	// Optional client-requested difficulty cap (e.g. after a worker timeout
	// on a slow device). The server still enforces a hard minimum so the
	// challenge is always worth something.
	difficulty := applyMaxDifficulty(c.Query("max_difficulty"), h.powDifficulty)

	// Generate challenge
	challengeID := randomHex(16)
	nonce := randomHex(16)
	now := time.Now()

	challenge := powChallenge{
		ChallengeID: challengeID,
		Nonce:       nonce,
		Difficulty:  difficulty,
		ExpiresAt:   now.Add(5 * time.Minute).Unix(),
		IssuedAt:    now.UnixMilli(),
	}

	// Store in Redis with 5 min TTL
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	data, _ := json.Marshal(challenge)
	h.redis.Set(ctx, "pow:challenge:"+challengeID, data, 5*time.Minute)

	c.JSON(http.StatusOK, models.SuccessResponse(challenge))
}

// Lua script for atomic GET + DELETE (compatible with Redis 2.6+).
// We don't use GETDEL because it requires Redis 6.2+ (not available on all managed instances).
var getAndDelScript = redis.NewScript(`
	local val = redis.call('GET', KEYS[1])
	if val then
		redis.call('DEL', KEYS[1])
	end
	return val
`)

// Captcha error sentinels — used by handlers/UI to distinguish between
// "challenge already used / not found" and "solution was wrong" so they can
// tell the user something actionable instead of the same generic message.
//
// They are real error values (not string constants) so callers can branch
// with errors.Is(err, handlers.ErrCaptchaExpired).
var (
	ErrCaptchaMissing = &captchaErr{code: "captcha_missing", message: "missing captcha fields"}
	ErrCaptchaExpired = &captchaErr{code: "captcha_expired", message: "captcha expired — please refresh"}
	ErrCaptchaOffline = &captchaErr{code: "captcha_offline", message: "captcha service temporarily unavailable"}
	ErrCaptchaInvalid = &captchaErr{code: "captcha_invalid", message: "captcha solution invalid — please try again"}
)

// applyMaxDifficulty clamps a client-requested difficulty cap to the valid
// range [minPowDifficulty, 32] and to below the server's default. Returns
// the effective difficulty to issue. Extracted so it can be unit-tested
// without a Redis dependency.
func applyMaxDifficulty(raw string, serverDefault int) int {
	if raw == "" {
		return serverDefault
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return serverDefault
	}
	if v < minPowDifficulty || v > 32 || v >= serverDefault {
		return serverDefault
	}
	return v
}

// VerifyPoW checks if a PoW solution is valid for the given challenge.
// For external mCaptcha: challengeID is empty, solution is the mCaptcha token.
// For built-in PoW: challengeID identifies the Redis-stored challenge, solution is the found nonce.
//
// On any verification error the returned error wraps one of the ErrCaptcha*
// sentinels via errors.Is, and the human-readable message is safe to show
// directly to the end user.
func (h *CaptchaHandler) VerifyPoW(challengeID, solution string) error {
	if h.IsConfigured() {
		return h.verifyExternalToken(solution)
	}

	if challengeID == "" || solution == "" {
		return ErrCaptchaMissing
	}

	if h.redis == nil {
		return ErrCaptchaOffline
	}

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	key := "pow:challenge:" + challengeID

	// Atomic GET + DELETE via Lua (works on all Redis versions)
	data, err := getAndDelScript.Run(ctx, h.redis, []string{key}).Text()
	if err != nil {
		log.Printf("[CAPTCHA] Redis error for challenge %s: %v", challengeID[:min(8, len(challengeID))], err)
		return ErrCaptchaOffline
	}
	if data == "" {
		log.Printf("[CAPTCHA] Challenge not found (expired or already used): %s", challengeID[:min(8, len(challengeID))])
		return ErrCaptchaExpired
	}

	var challenge powChallenge
	if err := json.Unmarshal([]byte(data), &challenge); err != nil {
		log.Printf("[CAPTCHA] Corrupt challenge data: %v", err)
		return ErrCaptchaExpired
	}

	// Verify solution: SHA256(challengeID + nonce + solution) must have 'difficulty' leading zero bits
	input := challenge.ChallengeID + challenge.Nonce + solution
	hash := sha256.Sum256([]byte(input))

	if !hasLeadingZeroBits(hash[:], challenge.Difficulty) {
		hashHex := hex.EncodeToString(hash[:])
		log.Printf("[CAPTCHA] PoW failed: challenge=%s solution_len=%d difficulty=%d hash=%s",
			challengeID[:min(8, len(challengeID))], len(solution), challenge.Difficulty, hashHex[:16])
		return ErrCaptchaInvalid
	}

	return nil
}

// captchaError builds a typed error that wraps the sentinel code so callers
// can match on it with errors.Is(err, ErrCaptchaXxx). The Code() method is
// available for direct access without unwrapping.
type captchaErr struct {
	code    string
	message string
}

func (e *captchaErr) Error() string { return e.message }

// Is matches against any of the package-level sentinels by code, so callers
// can write errors.Is(err, handlers.ErrCaptchaExpired) without caring
// whether the receiver was built via captchaError() or is a sentinel itself.
func (e *captchaErr) Is(target error) bool {
	var t *captchaErr
	if errors.As(target, &t) {
		return e.code == t.code
	}
	return false
}

// Code returns the sentinel code constant for this error.
func (e *captchaErr) Code() string { return e.code }

// captchaError is kept for any future ad-hoc error sites, but VerifyPoW now
// returns the sentinels directly so the message is always a single source of
// truth. Avoid using it in new code unless you need a code that doesn't have
// a sentinel yet.
func captchaError(code, msg string) error { return &captchaErr{code: code, message: msg} }

// deriveMCaptchaWidgetURL picks the base URL where the mCaptcha widget JS is
// served. If the operator set MCAPTCHA_WIDGET_URL explicitly, that wins.
// Otherwise we derive it from MCAPTCHA_VERIFY_URL by taking the URL's origin
// (scheme + host + port), which is where the widget bundle is also served
// by the mCaptcha server. Using url.Parse (not string-suffix stripping) means
// trailing slashes, query strings, and fragments on the verify URL don't
// break the derivation.
//
// Extracted so it can be unit-tested without touching env vars or Redis.
func deriveMCaptchaWidgetURL(explicit, verifyURL string) string {
	if explicit != "" {
		return explicit
	}
	if verifyURL == "" {
		return ""
	}
	u, err := url.Parse(verifyURL)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host
}

// hasLeadingZeroBits checks if the byte slice has at least 'n' leading zero bits.
func hasLeadingZeroBits(data []byte, n int) bool {
	fullBytes := n / 8
	remainingBits := n % 8

	for i := 0; i < fullBytes; i++ {
		if i >= len(data) {
			return false
		}
		if data[i] != 0 {
			return false
		}
	}

	if remainingBits > 0 {
		if fullBytes >= len(data) {
			return false
		}
		mask := byte(0xFF) << (8 - remainingBits)
		if data[fullBytes]&mask != 0 {
			return false
		}
	}

	return true
}

// ── External mCaptcha verification ─────────────────────────────────────────

// verifyExternalToken sends the mCaptcha token to the mCaptcha server for verification.
func (h *CaptchaHandler) verifyExternalToken(token string) error {
	if token == "" {
		return fmt.Errorf("captcha token is required")
	}

	body := map[string]string{
		"token":  token,
		"key":    h.siteKey,
		"secret": h.secret,
	}
	jsonBody, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("failed to marshal captcha verification request: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "POST", h.verifyURL, bytes.NewReader(jsonBody))
	if err != nil {
		return fmt.Errorf("failed to create captcha verification request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := h.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("captcha verification service unavailable: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if err != nil {
		return fmt.Errorf("failed to read captcha verification response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("captcha verification failed (HTTP %d): %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		Valid bool `json:"valid"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return fmt.Errorf("unexpected captcha verification response: %s", string(respBody))
	}

	if !result.Valid {
		return fmt.Errorf("captcha verification failed: token is invalid")
	}

	return nil
}

// ── Helpers ────────────────────────────────────────────────────────────────
// (randomHex is defined in auth.go and available package-wide)
