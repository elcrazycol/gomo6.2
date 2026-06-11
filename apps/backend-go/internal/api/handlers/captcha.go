package handlers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
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
	httpClient *http.Client
	// PoW difficulty: number of leading zero bits required in SHA-256 hash.
	// 16 bits = ~65k hashes avg (fast for humans, expensive for bots)
	powDifficulty int
}

// NewCaptchaHandler creates a new CaptchaHandler.
// Reads optional mCaptcha config from env vars:
//
//	MCAPTCHA_SITE_KEY  — public site key (exposed to frontend)
//	MCAPTCHA_SECRET    — secret for backend verification
//	MCAPTCHA_VERIFY_URL — mCaptcha server verification endpoint
//	MCAPTCHA_POW_DIFFICULTY — PoW difficulty in bits (default: 20, ~1M iterations)
//
// If mCaptcha is NOT configured, built-in Proof-of-Work is used as fallback.
func NewCaptchaHandler(redis *redis.Client) *CaptchaHandler {
	difficulty := 20 // ~1M hashes avg, ~1-2s on modern hardware
	if d := os.Getenv("MCAPTCHA_POW_DIFFICULTY"); d != "" {
		if parsed, err := strconv.Atoi(d); err == nil && parsed >= 8 && parsed <= 32 {
			difficulty = parsed
		}
	}

	return &CaptchaHandler{
		redis:         redis,
		siteKey:       os.Getenv("MCAPTCHA_SITE_KEY"),
		secret:        os.Getenv("MCAPTCHA_SECRET"),
		verifyURL:     os.Getenv("MCAPTCHA_VERIFY_URL"),
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
			"type":     "mcaptcha",
			"enabled":  true,
			"site_key": h.siteKey,
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
	ExpiresAt   int64  `json:"expires_at"` // unix timestamp
}

// GetChallenge generates a new PoW challenge and stores it in Redis.
// GET /api/v1/auth/captcha-challenge
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

	// Generate challenge
	challengeID := randomHex(16)
	nonce := randomHex(16)

	challenge := powChallenge{
		ChallengeID: challengeID,
		Nonce:       nonce,
		Difficulty:  h.powDifficulty,
		ExpiresAt:   time.Now().Add(5 * time.Minute).Unix(),
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

// VerifyPoW checks if a PoW solution is valid for the given challenge.
// For external mCaptcha: challengeID is empty, solution is the mCaptcha token.
// For built-in PoW: challengeID identifies the Redis-stored challenge, solution is the found nonce.
func (h *CaptchaHandler) VerifyPoW(challengeID, solution string) error {
	if h.IsConfigured() {
		return h.verifyExternalToken(solution)
	}

	if challengeID == "" || solution == "" {
		return fmt.Errorf("missing captcha fields")
	}

	if h.redis == nil {
		return fmt.Errorf("captcha service offline")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	key := "pow:challenge:" + challengeID

	// Atomic GET + DELETE via Lua (works on all Redis versions)
	data, err := getAndDelScript.Run(ctx, h.redis, []string{key}).Text()
	if err != nil {
		log.Printf("[CAPTCHA] Redis error for challenge %s: %v", challengeID[:min(8, len(challengeID))], err)
		return fmt.Errorf("captcha expired — refresh and try again")
	}
	if data == "" {
		log.Printf("[CAPTCHA] Challenge not found: %s", challengeID[:min(8, len(challengeID))])
		return fmt.Errorf("captcha expired — refresh and try again")
	}

	var challenge powChallenge
	if err := json.Unmarshal([]byte(data), &challenge); err != nil {
		log.Printf("[CAPTCHA] Corrupt challenge data: %v", err)
		return fmt.Errorf("captcha expired — refresh and try again")
	}

	// Verify solution: SHA256(challengeID + nonce + solution) must have 'difficulty' leading zero bits
	input := challenge.ChallengeID + challenge.Nonce + solution
	hash := sha256.Sum256([]byte(input))

	if !hasLeadingZeroBits(hash[:], challenge.Difficulty) {
		hashHex := hex.EncodeToString(hash[:])
		log.Printf("[CAPTCHA] PoW failed: challenge=%s solution_len=%d difficulty=%d hash=%s",
			challengeID[:min(8, len(challengeID))], len(solution), challenge.Difficulty, hashHex[:16])
		return fmt.Errorf("captcha failed — please try again")
	}

	return nil
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
