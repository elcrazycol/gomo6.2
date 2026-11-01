package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

type Claims struct {
	UserID    string `json:"user_id"`
	Username  string `json:"username"`
	Domain    string `json:"domain"`
	SessionID string `json:"sid,omitempty"` // stable user_sessions.id; empty for OAuth/bot tokens
	jwt.RegisteredClaims
}

// TokenPair is returned on login/register — contains both an access token
// (short-lived JWT) and a refresh token (opaque, 3 days). SessionID is the
// stable session this pair belongs to; AccessJTI is the jti of the access
// token (used for instant revocation). AccessJTI is intentionally never
// serialized to clients.
type TokenPair struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	SessionID    string `json:"-"`
	AccessJTI    string `json:"-"`
	ExpiresIn    int64  `json:"expires_in"` // seconds until access token expires
}

type AuthService struct {
	jwtSecret []byte
	redis     *redis.Client // optional — enables token blacklist and refresh tokens
}

func NewAuthService() *AuthService {
	return &AuthService{
		jwtSecret: []byte(GetJWTSecret()),
	}
}

// SetRedis enables optional Redis-backed features: token blacklist and refresh tokens.
func (a *AuthService) SetRedis(rdb *redis.Client) {
	a.redis = rdb
}

// GetJWTSecret returns the JWT secret from env.
// In production, JWT_SECRET is REQUIRED — the server will refuse to start without it.
// In development, a random key is generated with a warning.
func GetJWTSecret() string {
	if secret := os.Getenv("JWT_SECRET"); secret != "" {
		if len(secret) < 32 {
			log.Printf("WARNING: JWT_SECRET is too short (%d bytes). Use at least 32 bytes (64 hex chars) for production.", len(secret))
		}
		return secret
	}

	env := os.Getenv("ENVIRONMENT")
	if env == "production" || env == "prod" {
		log.Fatalf("FATAL: JWT_SECRET environment variable is required in production. Set a strong, fixed value (at least 64 hex characters).")
	}

	// Auto-generate a secure random key for development
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		log.Fatalf("FATAL: Failed to generate random JWT secret: %v", err)
	}
	secret := hex.EncodeToString(b)
	log.Printf("WARNING: JWT_SECRET not set. Generated random key. All tokens will be invalidated on next restart.")
	log.Printf("WARNING: Set JWT_SECRET environment variable to a fixed value for production (e.g.: %s)", secret)
	return secret
}

// generateAccessToken creates an access token with a 1-hour TTL, a unique jti
// and the stable session id (if any). Returns the token and its jti.
func (a *AuthService) generateAccessToken(userID, username, domain, sessionID string) (string, string, error) {
	now := time.Now()
	claims := Claims{
		UserID:    userID,
		Username:  username,
		Domain:    domain,
		SessionID: sessionID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(1 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(now),
			ID:        uuid.New().String(),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(a.jwtSecret)
	if err != nil {
		return "", "", err
	}
	return signed, claims.ID, nil
}

// GenerateToken creates an access token with a 1-hour TTL and unique jti.
// The token carries no session binding (used by OAuth and API clients).
func (a *AuthService) GenerateToken(userID, username, domain string) (string, error) {
	token, _, err := a.generateAccessToken(userID, username, domain, "")
	return token, err
}

// GenerateTokenPair creates both an access token (1h) and a refresh token (3 days)
// bound to the given stable session id. The refresh token hash is stored in
// Redis (if available) for later validation.
func (a *AuthService) GenerateTokenPair(userID, username, domain, sessionID string) (*TokenPair, error) {
	accessToken, accessJTI, err := a.generateAccessToken(userID, username, domain, sessionID)
	if err != nil {
		return nil, err
	}

	refreshToken, err := generateRefreshToken()
	if err != nil {
		return nil, err
	}

	// Store refresh token hash in Redis with 3-day TTL. Refresh tokens ARE
	// rotated on every /refresh (see RefreshAccessToken), so a captured token
	// dies at the victim's next refresh at the latest; reuse past the grace
	// window revokes everything.
	if a.redis != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
		defer cancel()
		hash := sha256.Sum256([]byte(refreshToken))
		key := fmt.Sprintf("refresh:%s:%s", userID, hex.EncodeToString(hash[:]))
		a.redis.Set(ctx, key, "1", 3*24*time.Hour)
	}

	return &TokenPair{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		SessionID:    sessionID,
		AccessJTI:    accessJTI,
		ExpiresIn:    3600, // 1 hour
	}, nil
}

// ErrRefreshTokenNotFound is returned when a refresh token doesn't exist in Redis.
// The handler uses this to distinguish "not found" (benign) from "generation failed
// after finding the token" (potential theft).
var ErrRefreshTokenNotFound = fmt.Errorf("refresh token not found")

// ─── Passkey re-authentication tokens ──────────────────────────────────────
// A reauth token proves the user completed a FRESH passkey ceremony within the
// last 5 minutes. Sensitive account actions (password change without knowing
// the current password, 2FA enrollment, passkey deletion) accept it as an
// alternative to the current password — "use passkey instead of password".
// Single-use (burned on first consume) and bound to the user id, so a leaked
// token cannot be replayed and cannot be retargeted at another account.

// ReauthClaims is the purpose-bound claim set for re-authentication tokens.
// It is deliberately separate from Claims: purpose confusion between a session
// token and a reauth token must be impossible by construction.
type ReauthClaims struct {
	UserID  string `json:"user_id"`
	Purpose string `json:"purpose"`
	jwt.RegisteredClaims
}

const (
	reauthPurpose = "webauthn-reauth-v1"
	reauthTTL     = 5 * time.Minute
)

// ReauthTTLSeconds reports the re-authentication token lifetime for API responses.
func ReauthTTLSeconds() int {
	return int(reauthTTL.Seconds())
}

// GenerateReauthToken mints a 5-minute single-use re-authentication token.
func (a *AuthService) GenerateReauthToken(userID string) (string, error) {
	now := time.Now()
	claims := ReauthClaims{
		UserID:  userID,
		Purpose: reauthPurpose,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(reauthTTL)),
			IssuedAt:  jwt.NewNumericDate(now),
			ID:        uuid.New().String(),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(a.jwtSecret)
}

// ConsumeReauthToken validates a re-authentication token for the given user
// and burns it (single-use via Redis SETNX). Fail-closed: without Redis the
// burn cannot be recorded, so every token is rejected.
func (a *AuthService) ConsumeReauthToken(userID, tokenString string) error {
	if a.redis == nil || userID == "" || tokenString == "" {
		return fmt.Errorf("re-auth unavailable")
	}
	token, err := jwt.ParseWithClaims(tokenString, &ReauthClaims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return a.jwtSecret, nil
	})
	if err != nil {
		return fmt.Errorf("invalid re-auth token: %w", err)
	}
	claims, ok := token.Claims.(*ReauthClaims)
	if !ok || !token.Valid {
		return fmt.Errorf("invalid re-auth token")
	}
	if claims.Purpose != reauthPurpose {
		return fmt.Errorf("invalid re-auth token")
	}
	if claims.UserID == "" || claims.UserID != userID {
		return fmt.Errorf("invalid re-auth token")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	key := fmt.Sprintf("reauth_used:%s", claims.ID)
	set, err := a.redis.SetNX(ctx, key, "1", reauthTTL).Result()
	if err != nil {
		return fmt.Errorf("re-auth unavailable: %w", err)
	}
	if !set {
		return fmt.Errorf("re-auth token already used")
	}
	return nil
}

// ErrRefreshTokenReused is returned when a refresh token is presented that was
// already rotated out (its tombstone exists and the grace window has passed).
// This is the signature of token theft — two parties holding the same refresh
// token — and the handler must revoke ALL sessions of the user.
var ErrRefreshTokenReused = fmt.Errorf("refresh token reuse detected")

const (
	// refreshGraceTTL is how long a rotated-out refresh token still maps to
	// its replacement. Concurrent refreshes (multiple tabs firing /refresh at
	// once with the same pre-rotation value) converge on the current token
	// instead of forking the session or tripping reuse-detection.
	refreshGraceTTL = 90 * time.Second
	// refreshReuseTTL bounds the theft-detection window: a rotated-out token
	// presented after the grace window is treated as stolen.
	refreshReuseTTL = 3 * 24 * time.Hour
)

func refreshKey(userID, tokenHash string) string {
	return fmt.Sprintf("refresh:%s:%s", userID, tokenHash)
}

func refreshGraceKey(userID, oldHash string) string {
	return fmt.Sprintf("refresh_grace:%s:%s", userID, oldHash)
}

func refreshReusedKey(userID, oldHash string) string {
	return fmt.Sprintf("refresh_reused:%s:%s", userID, oldHash)
}

// ValidateRefreshToken reports whether an opaque refresh token is currently
// valid for the supplied user. It never rotates or consumes the token.
// A missing Redis backend is fail-closed because refresh-token validity cannot
// be established without the server-side record.
func (a *AuthService) ValidateRefreshToken(userID, refreshToken string) bool {
	return userID != "" && refreshToken != "" && a.refreshTokenExists(userID, refreshToken)
}

// ResolveRefreshToken maps a presented refresh token to the CURRENT raw token
// of the session: the token itself when live, or its rotation replacement when
// presented inside the grace window (concurrent-tab refresh). Used by logout
// so a tab holding a just-rotated cookie can still kill its own session.
// Returns ("", false) when the token is unknown.
func (a *AuthService) ResolveRefreshToken(userID, refreshToken string) (string, bool) {
	if a.redis == nil || userID == "" || refreshToken == "" {
		return "", false
	}
	if a.refreshTokenExists(userID, refreshToken) {
		return refreshToken, true
	}
	if replacement, ok := a.graceReplacement(userID, refreshToken); ok {
		return replacement, true
	}
	return "", false
}

// IsRefreshTokenReused reports whether the token was rotated out longer than
// the grace window ago — i.e. somebody is replaying a dead token.
func (a *AuthService) IsRefreshTokenReused(userID, refreshToken string) bool {
	if a.redis == nil || userID == "" || refreshToken == "" {
		return false
	}
	hash := sha256.Sum256([]byte(refreshToken))
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	exists, err := a.redis.Exists(ctx, refreshReusedKey(userID, hex.EncodeToString(hash[:]))).Result()
	return err == nil && exists > 0
}

// GraceReplacement returns the rotation replacement for a recently rotated
// token (concurrent-refresh convergence), or ("", false).
func (a *AuthService) GraceReplacement(userID, refreshToken string) (string, bool) {
	if a.redis == nil || userID == "" || refreshToken == "" {
		return "", false
	}
	return a.graceReplacement(userID, refreshToken)
}

// graceReplacement returns the rotation replacement for a recently rotated
// token (concurrent-refresh convergence), or ("", false).
func (a *AuthService) graceReplacement(userID, refreshToken string) (string, bool) {
	hash := sha256.Sum256([]byte(refreshToken))
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	val, err := a.redis.Get(ctx, refreshGraceKey(userID, hex.EncodeToString(hash[:]))).Result()
	if err != nil || val == "" {
		return "", false
	}
	return val, true
}

// IssueAccessToken mints a fresh access token bound to an existing session
// without touching any refresh token. Used for the grace-window path where
// the session already rotated and only the access token needs re-issuing.
func (a *AuthService) IssueAccessToken(userID, username, domain, sessionID string) (*TokenPair, error) {
	accessToken, accessJTI, err := a.generateAccessToken(userID, username, domain, sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to generate new access token: %w", err)
	}
	return &TokenPair{
		AccessToken: accessToken,
		SessionID:   sessionID,
		AccessJTI:   accessJTI,
		ExpiresIn:   3600, // 1 hour
	}, nil
}

// RefreshAccessToken validates a refresh token, ROTATES it, and issues a
// fresh access token bound to the same session.
//
// Why rotation with a grace window? A stable refresh token means a stolen
// token is silently usable for its whole 3-day lifetime by both parties.
// Rotation bounds theft: the first use after the steal forks the session and
// the loser's token dies. Naive rotation breaks concurrent refreshes (N tabs
// read the same cookie value; the losers get 401 and the frontend logs the
// user out), so:
//   - the rotated-out token maps to its replacement for refreshGraceTTL
//     (grace path: same pair re-issued, no fork, no logout);
//   - past the grace window a rotated-out token carries a tombstone for
//     refreshReuseTTL and its presentation returns ErrRefreshTokenReused —
//     the theft signature — so the handler can revoke EVERYTHING.
func (a *AuthService) RefreshAccessToken(userID, username, domain, sessionID, refreshToken string) (*TokenPair, error) {
	if a.redis == nil {
		return nil, ErrRefreshTokenNotFound
	}
	oldHash := sha256.Sum256([]byte(refreshToken))
	oldHashHex := hex.EncodeToString(oldHash[:])

	// Step 1: live token → rotate. Grace-window replay → re-issue same pair.
	if !a.refreshTokenExists(userID, refreshToken) {
		if replacement, ok := a.graceReplacement(userID, refreshToken); ok {
			accessToken, accessJTI, err := a.generateAccessToken(userID, username, domain, sessionID)
			if err != nil {
				return nil, fmt.Errorf("failed to generate new access token: %w", err)
			}
			return &TokenPair{
				AccessToken:  accessToken,
				RefreshToken: replacement,
				SessionID:    sessionID,
				AccessJTI:    accessJTI,
				ExpiresIn:    3600,
			}, nil
		}
		if a.IsRefreshTokenReused(userID, refreshToken) {
			return nil, ErrRefreshTokenReused
		}
		return nil, ErrRefreshTokenNotFound
	}

	// Step 2: mint the replacement and publish the rotation atomically-ish.
	// The new key is written BEFORE the old key is deleted so a crash between
	// the two can never lock the session out; the tombstone + grace keys make
	// the rotation observable to concurrent requests either way.
	newRaw, err := generateRefreshToken()
	if err != nil {
		return nil, fmt.Errorf("failed to generate refresh token: %w", err)
	}
	newHash := sha256.Sum256([]byte(newRaw))
	newHashHex := hex.EncodeToString(newHash[:])

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()
	pipe := a.redis.Pipeline()
	pipe.Set(ctx, refreshKey(userID, newHashHex), "1", 3*24*time.Hour)
	pipe.Set(ctx, refreshGraceKey(userID, oldHashHex), newRaw, refreshGraceTTL)
	pipe.Set(ctx, refreshReusedKey(userID, oldHashHex), "1", refreshReuseTTL)
	pipe.Del(ctx, refreshKey(userID, oldHashHex))
	if _, err := pipe.Exec(ctx); err != nil {
		return nil, fmt.Errorf("failed to rotate refresh token: %w", err)
	}

	// Step 3: fresh access token bound to the same session.
	accessToken, accessJTI, err := a.generateAccessToken(userID, username, domain, sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to generate new access token: %w", err)
	}

	return &TokenPair{
		AccessToken:  accessToken,
		RefreshToken: newRaw, // rotated — the presented token is now dead
		SessionID:    sessionID,
		AccessJTI:    accessJTI,
		ExpiresIn:    3600, // 1 hour
	}, nil
}

// RefreshTokenExistsByHash reports whether a refresh token whose SHA-256 hex
// hash is refreshHash is still stored for the user. Used by the session cap to
// tell live sessions (refresh token present) apart from dead rows (token
// expired/revoked), so the cap only reaps the dead ones.
func (a *AuthService) RefreshTokenExistsByHash(userID, refreshHash string) bool {
	if a.redis == nil || refreshHash == "" {
		return false
	}

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	val, err := a.redis.Get(ctx, fmt.Sprintf("refresh:%s:%s", userID, refreshHash)).Result()
	return err == nil && val != ""
}

// DeleteRefreshTokenByHash removes a stored refresh token given its SHA-256 hex
// hash (as kept in user_sessions.refresh_hash). Used when revoking a session
// whose raw refresh token is not available to the caller.
func (a *AuthService) DeleteRefreshTokenByHash(userID, refreshHash string) {
	if a.redis == nil || refreshHash == "" {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	a.redis.Del(ctx, fmt.Sprintf("refresh:%s:%s", userID, refreshHash))
}

func generateRefreshToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("failed to generate refresh token: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// refreshTokenExists checks if a refresh token exists in Redis (does NOT delete it).
func (a *AuthService) refreshTokenExists(userID, refreshToken string) bool {
	if a.redis == nil {
		return false
	}

	hash := sha256.Sum256([]byte(refreshToken))
	key := fmt.Sprintf("refresh:%s:%s", userID, hex.EncodeToString(hash[:]))

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	val, err := a.redis.Get(ctx, key).Result()
	return err == nil && val != ""
}

// RevokeAllRefreshTokens removes all refresh tokens for a user (logout all sessions).
func (a *AuthService) RevokeAllRefreshTokens(userID string) {
	if a.redis == nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	// SCAN for all refresh:* keys for this user and delete them
	iter := a.redis.Scan(ctx, 0, fmt.Sprintf("refresh:%s:*", userID), 100).Iterator()
	for iter.Next(ctx) {
		a.redis.Del(ctx, iter.Val())
	}
}

func (a *AuthService) GeneratePartialToken(userID, username, domain string) (string, error) {
	now := time.Now()
	claims := Claims{
		UserID:   userID,
		Username: username,
		Domain:   domain,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(5 * time.Minute)),
			IssuedAt:  jwt.NewNumericDate(now),
			ID:        uuid.New().String(),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(a.jwtSecret)
}

func (a *AuthService) ValidateToken(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return a.jwtSecret, nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		// Check blacklist (if Redis is available). A Redis failure must not turn
		// token validation into an implicit allow: revocation is security-critical.
		blacklisted, blacklistErr := a.tokenBlacklistStatus(claims.ID)
		if blacklistErr != nil {
			return nil, fmt.Errorf("token revocation check failed: %w", blacklistErr)
		}
		if blacklisted {
			return nil, fmt.Errorf("token has been revoked")
		}
		return claims, nil
	}

	return nil, fmt.Errorf("invalid token")
}

// BlacklistToken adds a token's jti to the Redis blacklist, expiring when the token does.
func (a *AuthService) BlacklistToken(jti string, expiresAt time.Time) {
	if a.redis == nil || jti == "" {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	ttl := time.Until(expiresAt)
	if ttl <= 0 {
		return // already expired, no need to blacklist
	}

	key := fmt.Sprintf("blacklist:%s", jti)
	a.redis.Set(ctx, key, "1", ttl)
}

func (a *AuthService) tokenBlacklistStatus(jti string) (bool, error) {
	if a.redis == nil || jti == "" {
		return false, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	exists, err := a.redis.Exists(ctx, fmt.Sprintf("blacklist:%s", jti)).Result()
	if err != nil {
		return false, err
	}
	return exists > 0, nil
}

// isTokenBlacklisted is kept as a small boolean helper for internal callers and
// tests. ValidateToken uses tokenBlacklistStatus so Redis errors fail closed.
func (a *AuthService) isTokenBlacklisted(jti string) bool {
	blacklisted, err := a.tokenBlacklistStatus(jti)
	return err == nil && blacklisted
}
