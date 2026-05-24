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
	UserID   string `json:"user_id"`
	Username string `json:"username"`
	Domain   string `json:"domain"`
	jwt.RegisteredClaims
}

// TokenPair is returned on login/register — contains both an access token
// (short-lived JWT) and a refresh token (opaque, 7 days).
type TokenPair struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
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

// GetJWTSecret returns the JWT secret from env or generates a secure random one.
// In production, always set JWT_SECRET explicitly to keep tokens valid across restarts.
func GetJWTSecret() string {
	if secret := os.Getenv("JWT_SECRET"); secret != "" {
		if len(secret) < 32 {
			log.Printf("WARNING: JWT_SECRET is too short (%d bytes). Use at least 32 bytes (64 hex chars) for production.", len(secret))
		}
		return secret
	}

	// Auto-generate a secure random key
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		log.Fatalf("FATAL: Failed to generate random JWT secret: %v", err)
	}
	secret := hex.EncodeToString(b)
	log.Printf("WARNING: JWT_SECRET not set. Generated random key. All tokens will be invalidated on next restart.")
	log.Printf("WARNING: Set JWT_SECRET environment variable to a fixed value for production (e.g.: %s)", secret)
	return secret
}

// GenerateToken creates an access token with a 1-hour TTL and unique jti.
func (a *AuthService) GenerateToken(userID, username, domain string) (string, error) {
	now := time.Now()
	claims := Claims{
		UserID:   userID,
		Username: username,
		Domain:   domain,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(1 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(now),
			ID:        uuid.New().String(),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(a.jwtSecret)
}

// GenerateTokenPair creates both an access token (1h) and a refresh token (7 days).
// The refresh token hash is stored in Redis (if available) for later validation.
func (a *AuthService) GenerateTokenPair(userID, username, domain string) (*TokenPair, error) {
	accessToken, err := a.GenerateToken(userID, username, domain)
	if err != nil {
		return nil, err
	}

	refreshToken, err := generateRefreshToken()
	if err != nil {
		return nil, err
	}

	// Store refresh token hash in Redis with 7-day TTL
	if a.redis != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
		defer cancel()
		hash := sha256.Sum256([]byte(refreshToken))
		key := fmt.Sprintf("refresh:%s:%s", userID, hex.EncodeToString(hash[:]))
		a.redis.Set(ctx, key, "1", 7*24*time.Hour)
	}

	return &TokenPair{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    3600, // 1 hour
	}, nil
}

// ErrRefreshTokenNotFound is returned when a refresh token doesn't exist in Redis.
// The handler uses this to distinguish "not found" (benign) from "generation failed
// after finding the token" (potential theft).
var ErrRefreshTokenNotFound = fmt.Errorf("refresh token not found")

// RefreshAccessToken validates a refresh token, generates a new pair first,
// then deletes the old token (safe rotation — no window where user loses access).
func (a *AuthService) RefreshAccessToken(userID, username, domain, refreshToken string) (*TokenPair, error) {
	// Step 1: Check the old refresh token exists
	if !a.refreshTokenExists(userID, refreshToken) {
		return nil, ErrRefreshTokenNotFound
	}

	// Step 2: Generate the new pair FIRST
	pair, err := a.GenerateTokenPair(userID, username, domain)
	if err != nil {
		return nil, fmt.Errorf("failed to generate new token pair: %w", err)
	}

	// Step 3: Delete the old refresh token only after new one is generated
	a.deleteRefreshToken(userID, refreshToken)

	return pair, nil
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

// deleteRefreshToken removes a specific refresh token from Redis (used during rotation).
func (a *AuthService) deleteRefreshToken(userID, refreshToken string) {
	if a.redis == nil {
		return
	}

	hash := sha256.Sum256([]byte(refreshToken))
	key := fmt.Sprintf("refresh:%s:%s", userID, hex.EncodeToString(hash[:]))

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	a.redis.Del(ctx, key)
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
		// Check blacklist (if Redis is available)
		if a.isTokenBlacklisted(claims.ID) {
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

func (a *AuthService) isTokenBlacklisted(jti string) bool {
	if a.redis == nil || jti == "" {
		return false
	}

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	val, err := a.redis.Get(ctx, fmt.Sprintf("blacklist:%s", jti)).Result()
	return err == nil && val != ""
}
