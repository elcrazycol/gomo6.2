package middleware

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/redis/go-redis/v9"
)

const (
	authCacheTTL       = 2 * time.Minute
	authRedisTimeout   = 100 * time.Millisecond
	authCacheUserKey   = "auth:user:%s:tokens"
	authCacheVersion   = "auth:user:%s:version"
	authCacheKeyPrefix = "auth:token:"
)

type cachedClaims struct {
	Claims  auth.Claims `json:"claims"`
	Version string      `json:"version"`
}

// AuthCacheMiddleware provides Redis-based caching for auth token validation.
// Cached claims are never trusted without checking expiry and the live blacklist.
func AuthCacheMiddleware(authService *auth.AuthService, redisClient *redis.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		// BotAuthMiddleware may provide database-backed bot claims rather than a
		// JWT. Human claims must still be revalidated here so expiry, blacklist,
		// and auth-cache generation checks cannot be bypassed by an earlier
		// optional-auth middleware.
		if isBot, ok := c.Get("is_bot"); ok && isBot == true {
			botID, hasBotID := c.Get("bot_id")
			if hasBotID && botID != nil && fmt.Sprint(botID) != "" {
				c.Next()
				return
			}
		}

		authHeader := c.GetHeader("Authorization")
		if authHeader != "" {
			tokenParts := strings.Split(authHeader, " ")
			if len(tokenParts) == 2 && tokenParts[0] == "Bearer" &&
				tryValidateAndCache(authService, redisClient, c, tokenParts[1]) {
				return
			}
		}

		if token := c.Query("token"); token != "" && tryValidateAndCache(authService, redisClient, c, token) {
			return
		}

		if c.GetHeader("Upgrade") == "websocket" {
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization required"})
		c.Abort()
	}
}

// tryValidateAndCache attempts to validate a token against cache (Redis) and JWT.
func tryValidateAndCache(authService *auth.AuthService, redisClient *redis.Client, c *gin.Context, token string) bool {
	cacheKey := fmt.Sprintf("%s%x", authCacheKeyPrefix, sha256.Sum256([]byte(token)))

	if redisClient != nil {
		ctx, cancel := context.WithTimeout(c.Request.Context(), authRedisTimeout)
		cachedData, err := redisClient.Get(ctx, cacheKey).Result()
		cancel()
		if err == nil && cachedData != "" {
			var cached cachedClaims
			if json.Unmarshal([]byte(cachedData), &cached) == nil {
				claims := &cached.Claims
				versionCtx, versionCancel := context.WithTimeout(c.Request.Context(), authRedisTimeout)
				currentVersion, versionErr := redisClient.Get(versionCtx, fmt.Sprintf(authCacheVersion, claims.UserID)).Result()
				versionCancel()
				if versionErr == redis.Nil {
					currentVersion = "0"
				} else if versionErr != nil {
					return abortAuthDependency(c)
				}
				if cached.Version == currentVersion && claims.ID != "" && claims.ExpiresAt != nil && claims.ExpiresAt.After(time.Now()) {
					blacklisted, blacklistErr := cachedTokenBlacklisted(c, redisClient, claims.ID)
					if blacklistErr != nil {
						return abortAuthDependency(c)
					}
					if !blacklisted {
						c.Set("claims", claims)
						c.Next()
						return true
					}
				}
				// Expired, revoked, stale-generation, or non-revocable cache entries
				// are not trusted and are removed when possible.
				if claims.ExpiresAt == nil || !claims.ExpiresAt.After(time.Now()) || cached.Version != currentVersion || claims.ID == "" {
					ctx, cancel := context.WithTimeout(c.Request.Context(), authRedisTimeout)
					_ = redisClient.Del(ctx, cacheKey).Err()
					cancel()
				}
			}
		}
	}

	claims, err := authService.ValidateToken(token)
	if err != nil || claims.ExpiresAt == nil || !claims.ExpiresAt.After(time.Now()) {
		return false
	}

	if redisClient != nil {
		if claimsJSON, marshalErr := json.Marshal(claims); marshalErr == nil && claims.ID != "" {
			versionCtx, versionCancel := context.WithTimeout(c.Request.Context(), authRedisTimeout)
			version, versionErr := redisClient.Get(versionCtx, fmt.Sprintf(authCacheVersion, claims.UserID)).Result()
			versionCancel()
			if versionErr == redis.Nil {
				version = "0"
			} else if versionErr != nil {
				return abortAuthDependency(c)
			}
			cacheValue, cacheMarshalErr := json.Marshal(cachedClaims{Claims: *claims, Version: version})
			if cacheMarshalErr != nil {
				return abortAuthDependency(c)
			}
			claimsJSON = cacheValue
			cacheTTL := authCacheTTL
			if remaining := time.Until(claims.ExpiresAt.Time); remaining < cacheTTL {
				cacheTTL = remaining
			}
			if cacheTTL > 0 {
				ctx, cancel := context.WithTimeout(c.Request.Context(), time.Second)
				pipe := redisClient.Pipeline()
				pipe.Set(ctx, cacheKey, claimsJSON, cacheTTL)
				pipe.SAdd(ctx, fmt.Sprintf(authCacheUserKey, claims.UserID), cacheKey)
				pipe.Expire(ctx, fmt.Sprintf(authCacheUserKey, claims.UserID), cacheTTL)
				_, _ = pipe.Exec(ctx)
				cancel()
			}
		}
	}

	c.Set("claims", claims)
	c.Next()
	return true
}

func cachedTokenBlacklisted(c *gin.Context, redisClient *redis.Client, jti string) (bool, error) {
	if jti == "" {
		return false, nil
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), authRedisTimeout)
	defer cancel()
	exists, err := redisClient.Exists(ctx, fmt.Sprintf("blacklist:%s", jti)).Result()
	return exists > 0, err
}

// InvalidateAuthCache removes every cached token for a user. It is called by
// logout and session-revocation paths so revocation does not wait for the TTL.
func InvalidateAuthCache(redisClient *redis.Client, userID string) {
	if redisClient == nil || userID == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	// Bump the per-user generation first. This invalidates cache entries that
	// predate the token-index set and avoids relying on a complete key list.
	versionKey := fmt.Sprintf(authCacheVersion, userID)
	if err := redisClient.Set(ctx, versionKey, fmt.Sprintf("%d", time.Now().UnixNano()), 24*time.Hour).Err(); err != nil {
		return
	}
	setKey := fmt.Sprintf(authCacheUserKey, userID)
	keys, err := redisClient.SMembers(ctx, setKey).Result()
	if err == nil && len(keys) > 0 {
		_ = redisClient.Del(ctx, keys...).Err()
	}
	_ = redisClient.Del(ctx, setKey).Err()
}

func abortAuthDependency(c *gin.Context) bool {
	if c.GetHeader("Upgrade") == "websocket" {
		c.AbortWithStatus(http.StatusServiceUnavailable)
	} else {
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "Authentication service unavailable"})
	}
	return true
}
