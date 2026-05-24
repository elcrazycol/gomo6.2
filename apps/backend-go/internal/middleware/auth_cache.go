package middleware

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/redis/go-redis/v9"
)

// AuthCacheMiddleware provides Redis-based caching for auth token validation.
// Supports Bearer token, query token (for WebSocket), and WebSocket upgrade abort.
// This significantly reduces load on JWT validation and database queries.
func AuthCacheMiddleware(authService *auth.AuthService, redisClient *redis.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Try Authorization header first
		authHeader := c.GetHeader("Authorization")
		if authHeader != "" {
			tokenParts := strings.Split(authHeader, " ")
			if len(tokenParts) == 2 && tokenParts[0] == "Bearer" {
				if tryValidateAndCache(authService, redisClient, c, tokenParts[1]) {
					return
				}
			}
		}

		// Try token from query parameter (for WebSocket connections)
		if token := c.Query("token"); token != "" {
			if tryValidateAndCache(authService, redisClient, c, token) {
				return
			}
		}

		// No valid auth found
		// For WebSocket upgrade, abort with 401 (no JSON body — browsers can't read it)
		if c.GetHeader("Upgrade") == "websocket" {
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}

		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "Authorization required",
		})
		c.Abort()
	}
}

// tryValidateAndCache attempts to validate a token against cache (Redis) and JWT.
// On success, sets claims in context, calls c.Next(), and returns true.
func tryValidateAndCache(authService *auth.AuthService, redisClient *redis.Client, c *gin.Context, token string) bool {
	cacheKey := fmt.Sprintf("auth:token:%s", token)

	// Try cache first
	if redisClient != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		cachedData, err := redisClient.Get(ctx, cacheKey).Result()
		cancel()
		if err == nil && cachedData != "" {
			var claims auth.Claims
			if err := json.Unmarshal([]byte(cachedData), &claims); err == nil {
				c.Set("claims", &claims)
				c.Next()
				return true
			}
		}
	}

	// Validate and cache
	claims, err := authService.ValidateToken(token)
	if err == nil {
		// Cache in background
		if redisClient != nil {
			go func() {
				ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
				defer cancel()
				claimsJSON, _ := json.Marshal(claims)
				redisClient.Set(ctx, cacheKey, claimsJSON, 2*time.Minute)
			}()
		}

		c.Set("claims", claims)
		c.Next()
		return true
	}

	return false
}

