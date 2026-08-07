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

	// Store refresh token hash in Redis with 3-day TTL. Refresh tokens are NOT
	// rotated (see RefreshAccessToken), so a short lifetime bounds the theft
	// window of a captured token — 3 days is the deliberate tradeoff.
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

// ValidateRefreshToken reports whether an opaque refresh token is currently
// valid for the supplied user. It never rotates or consumes the token.
// A missing Redis backend is fail-closed because refresh-token validity cannot
// be established without the server-side record.
func (a *AuthService) ValidateRefreshToken(userID, refreshToken string) bool {
	return userID != "" && refreshToken != "" && a.refreshTokenExists(userID, refreshToken)
}

// RefreshAccessToken validates a refresh token and issues a fresh ACCESS token
// only. The opaque refresh token is deliberately NOT rotated: it stays valid for
// its whole 3-day lifetime (bounded by the Redis TTL and the HttpOnly cookie
// MaxAge) and is killed only on logout/session revocation.
//
// Why no rotation? The browser fires several /auth/refresh calls concurrently
// on page load (getSession + auth/me 401 fallbacks from multiple components).
// With rotation, the first request consumes the shared refresh cookie and every
// parallel request that read the same pre-rotation value gets a 401, which the
// frontend treats as "session expired" — logging the user out on reload. A
// stable refresh token makes concurrent refreshes all succeed; it is a 256-bit
// random in an HttpOnly SameSite=Strict cookie, so the only way to obtain it is
// from the browser itself. Access tokens still rotate on every refresh and the
// previous access jti is blacklisted, so revocation stays instant.
func (a *AuthService) RefreshAccessToken(userID, username, domain, sessionID, refreshToken string) (*TokenPair, error) {
	// Step 1: Check the refresh token still exists
	if !a.refreshTokenExists(userID, refreshToken) {
		return nil, ErrRefreshTokenNotFound
	}

	// Step 2: Generate a new access token bound to the same session
	accessToken, accessJTI, err := a.generateAccessToken(userID, username, domain, sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to generate new access token: %w", err)
	}

	return &TokenPair{
		AccessToken:  accessToken,
		RefreshToken: refreshToken, // unchanged — the session identity is stable
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
