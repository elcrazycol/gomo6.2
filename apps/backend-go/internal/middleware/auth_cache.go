package middleware

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/redis/go-redis/v9"
)

// AuthCacheMiddleware provides Redis-based caching for auth token validation
// This significantly reduces load on JWT validation and database queries
func AuthCacheMiddleware(authService *auth.AuthService, redisClient *redis.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Get token from header
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "Authorization header required",
			})
			c.Abort()
			return
		}

		// Check Bearer token
		tokenParts := strings.Split(authHeader, " ")
		if len(tokenParts) != 2 || tokenParts[0] != "Bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid authorization header format",
			})
			c.Abort()
			return
		}

		token := tokenParts[1]
		cacheKey := fmt.Sprintf("auth:token:%s", token)

		// Try to get cached claims from Redis
		if redisClient != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
			defer cancel()

			cachedData, err := redisClient.Get(ctx, cacheKey).Result()
			if err == nil && cachedData != "" {
				// Cache hit - deserialize claims
				var claims auth.Claims
				if err := json.Unmarshal([]byte(cachedData), &claims); err == nil {
					c.Set("claims", &claims)
					c.Next()
					return
				}
			}
		}

		// Cache miss or Redis unavailable - validate token
		claims, err := authService.ValidateToken(token)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid token",
			})
			c.Abort()
			return
		}

		// Cache the validated claims in Redis (5 minute TTL)
		if redisClient != nil {
			go func() {
				ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
				defer cancel()

				claimsJSON, err := json.Marshal(claims)
				if err == nil {
					err = redisClient.Set(ctx, cacheKey, claimsJSON, 2*time.Minute).Err()
					if err != nil {
						log.Printf("[AuthCache] Failed to cache token: %v", err)
					}
				}
			}()
		}

		// Set claims in context
		c.Set("claims", claims)
		c.Next()
	}
}

// SupabaseAuthCacheMiddleware is a cached version of SupabaseAuthMiddleware
func SupabaseAuthCacheMiddleware(authService *auth.AuthService, redisClient *redis.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Try Authorization header first
		authHeader := c.GetHeader("Authorization")
		if authHeader != "" {
			tokenParts := strings.Split(authHeader, " ")
			if len(tokenParts) == 2 && tokenParts[0] == "Bearer" {
				token := tokenParts[1]
				cacheKey := fmt.Sprintf("auth:token:%s", token)

				// Try cache first
				if redisClient != nil {
					ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
					defer cancel()

					cachedData, err := redisClient.Get(ctx, cacheKey).Result()
					if err == nil && cachedData != "" {
						var claims auth.Claims
						if err := json.Unmarshal([]byte(cachedData), &claims); err == nil {
							c.Set("claims", &claims)
							c.Next()
							return
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
							redisClient.Set(ctx, cacheKey, claimsJSON, 30*time.Second)
						}()
					}

					c.Set("claims", claims)
					c.Next()
					return
				}
			}
		}

		// Try token from query parameter (for WebSocket connections)
		token := c.Query("token")
		if token != "" {
			cacheKey := fmt.Sprintf("auth:token:%s", token)

			// Try cache
			if redisClient != nil {
				ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
				defer cancel()

				cachedData, err := redisClient.Get(ctx, cacheKey).Result()
				if err == nil && cachedData != "" {
					var claims auth.Claims
					if err := json.Unmarshal([]byte(cachedData), &claims); err == nil {
						c.Set("claims", &claims)
						c.Next()
						return
					}
				}
			}

			claims, err := authService.ValidateToken(token)
			if err == nil {
				// Cache in background
				if redisClient != nil {
					go func() {
						ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
						defer cancel()
						claimsJSON, _ := json.Marshal(claims)
						redisClient.Set(ctx, cacheKey, claimsJSON, 30*time.Second)
					}()
				}

				c.Set("claims", claims)
				c.Next()
				return
			}
		}

		// Try apikey header (Supabase compatibility)
		apiKey := c.GetHeader("apikey")
		if apiKey != "" && apiKey == getEnvFromOS("SUPABASE_ANON_KEY", "your-anon-key") {
			// Allow anonymous access with apikey
			c.Next()
			return
		}

		// No valid auth found
		// Check if this is a WebSocket upgrade request
		if c.GetHeader("Upgrade") == "websocket" {
			// For WebSocket, just abort without sending JSON response
			// The WebSocket handler will handle the error
			c.Abort()
			return
		}

		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "Authorization required",
		})
		c.Abort()
	}
}
