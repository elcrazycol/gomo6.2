package middleware

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/redis/go-redis/v9"
)

// DefaultDataCacheTTL is the default TTL for data cache entries (2 minutes).
const DefaultDataCacheTTL = 2 * time.Minute

// cacheTTLByPath returns a differentiated TTL based on the request path:
// - 30s for threads/posts (frequently updated content)
// - 5min for boards/profiles (rarely changed)
// - 2min default for everything else
func cacheTTLByPath(path string, defaultTTL time.Duration) time.Duration {
	// Threads and posts: short TTL — content changes frequently
	if strings.Contains(path, "/threads") || strings.Contains(path, "/posts") {
		return 30 * time.Second
	}
	// Unified feed: same short TTL — mixes fresh threads and wall posts, so a
	// stale feed would hide brand-new content for minutes.
	if strings.Contains(path, "/feed") {
		return 30 * time.Second
	}
	// Profile walls embed interaction counts (likes/comments/reposts) that
	// change on every interaction — short TTL as a safety net on top of the
	// write-path invalidation in crud.go.
	if strings.Contains(path, "/profile_wall_") {
		return 30 * time.Second
	}
	// Boards and profiles: medium TTL — rarely change but must reflect updates quickly
	if strings.Contains(path, "/boards") || strings.Contains(path, "/profiles") {
		return 30 * time.Second
	}
	return defaultTTL
}

func DataCacheMiddleware(redisClient *redis.Client, ttl time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Only cache GET requests
		if c.Request.Method != "GET" {
			c.Next()
			return
		}

		// Skip if Redis is not available
		if redisClient == nil {
			c.Next()
			return
		}

		// Skip caching for achievements endpoints — they must be real-time
		if strings.Contains(c.Request.URL.Path, "achievements") {
			c.Next()
			return
		}

		// Translation proposals can change after every submit/vote/delete. There
		// is no generic CRUD write path to invalidate their GET cache, so caching
		// this endpoint would keep the runtime catalog stale for the full TTL.
		if strings.Contains(c.Request.URL.Path, "/translations") {
			c.Next()
			return
		}

		// Skip caching for notifications — user_id comes from auth claims, not query params,
		// so the cache key would collide across different users and invalidation would never match.
		if strings.Contains(c.Request.URL.Path, "notifications") {
			c.Next()
			return
		}

		// Skip caching for messenger endpoints — they must be real-time
		// Caching causes multi-minute delays in message delivery and conversation updates
		if strings.Contains(c.Request.URL.Path, "messenger") {
			c.Next()
			return
		}

		// Skip caching for gomosub text-channel chat — same realtime contract as
		// the messenger. History GETs must reflect every freshly sent message, and
		// writes have no generic CRUD invalidator (channel_messages is not in the
		// registry), so a cached page would serve stale/empty snapshots for the
		// whole TTL — exactly what a reload after sending messages would hit.
		if strings.Contains(c.Request.URL.Path, "gomosubchat") {
			c.Next()
			return
		}

		// Skip caching for drops endpoints — must reflect immediate balance changes and be per-user
		path := c.Request.URL.Path
		if strings.HasPrefix(path, "/api/v1/drops/wallet") ||
			strings.HasPrefix(path, "/api/v1/drops/history") ||
			strings.HasPrefix(path, "/api/v1/drops/users/search") ||
			strings.HasPrefix(path, "/api/v1/user/drops") {
			c.Next()
			return
		}

		// Determine TTL based on path (threads/posts=30s, boards/profiles=5min)
		effectiveTTL := cacheTTLByPath(c.Request.URL.Path, ttl)

		// Build cache key from path, query params AND the viewer identity.
		// Responses to authenticated endpoints (profile walls, friends, privacy
		// settings, likes, reposts, subscriptions) depend on WHO is asking: a wall
		// filtered for a friend is different from the same wall filtered for a
		// stranger, and an anonymous visitor must never receive a cache entry that
		// was populated by an authenticated user. The claims are populated by
		// OptionalAuthMiddleware, which MUST run before this middleware (routes.go).
		viewer := "anon"
		if claimsValue, ok := c.Get("claims"); ok {
			if claims, ok2 := claimsValue.(*auth.Claims); ok2 && claims != nil && claims.UserID != "" {
				viewer = claims.UserID
			}
		}
		cacheKey := fmt.Sprintf("data:%s?%s|viewer=%s", c.Request.URL.Path, c.Request.URL.RawQuery, viewer)

		// Try to get cached response
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		defer cancel()

		cachedData, err := redisClient.Get(ctx, cacheKey).Result()
		if err == nil && cachedData != "" {
			// Cache hit - return cached response
			var response map[string]interface{}
			if err := json.Unmarshal([]byte(cachedData), &response); err == nil {
				c.Header("X-Cache", "HIT")
				c.JSON(200, response)
				c.Abort()
				return
			}
		}

		// Cache miss - continue to handler
		c.Header("X-Cache", "MISS")

		// Store cache key in context for potential invalidation later
		c.Set("cache_key", cacheKey)

		// Capture response
		writer := &responseWriter{
			ResponseWriter: c.Writer,
			body:           []byte{},
		}
		c.Writer = writer

		c.Next()

		// Cache successful responses in background
		// Don't cache empty arrays or very small responses (likely empty results)
		if c.Writer.Status() == 200 && len(writer.body) > 10 {
			// Check if response is an empty array []
			bodyStr := string(writer.body)
			if bodyStr != "[]" && bodyStr != "{\"data\":[]}" {
				go func() {
					ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
					defer cancel()

					err := redisClient.Set(ctx, cacheKey, writer.body, effectiveTTL).Err()
					if err != nil {
						log.Printf("[DataCache] Failed to cache response: %v", err)
					}
				}()
			}
		}
	}
}

// responseWriter captures response body for caching
type responseWriter struct {
	gin.ResponseWriter
	body []byte
}

func (w *responseWriter) Write(b []byte) (int, error) {
	w.body = append(w.body, b...)
	return w.ResponseWriter.Write(b)
}
