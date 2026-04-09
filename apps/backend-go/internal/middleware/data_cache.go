package middleware

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

// DataCacheMiddleware provides Redis-based caching for GET requests
// Caches response data to reduce database load
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

		// Build cache key from path and query params
		cacheKey := fmt.Sprintf("data:%s?%s", c.Request.URL.Path, c.Request.URL.RawQuery)

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

		// Capture response
		writer := &responseWriter{
			ResponseWriter: c.Writer,
			body:           []byte{},
		}
		c.Writer = writer

		c.Next()

		// Cache successful responses in background
		if c.Writer.Status() == 200 && len(writer.body) > 0 {
			go func() {
				ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
				defer cancel()

				err := redisClient.Set(ctx, cacheKey, writer.body, ttl).Err()
				if err != nil {
					log.Printf("[DataCache] Failed to cache response: %v", err)
				}
			}()
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

// InvalidateCache removes cached data by pattern
func InvalidateCache(redisClient *redis.Client, pattern string) error {
	if redisClient == nil {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Find all keys matching pattern
	keys, err := redisClient.Keys(ctx, pattern).Result()
	if err != nil {
		return err
	}

	// Delete all matching keys
	if len(keys) > 0 {
		return redisClient.Del(ctx, keys...).Err()
	}

	return nil
}

// InvalidateCacheForThread invalidates all cache entries related to a thread
func InvalidateCacheForThread(redisClient *redis.Client, threadID string) {
	patterns := []string{
		fmt.Sprintf("data:/rest/v1/posts?thread_id=eq.%s*", threadID),
		fmt.Sprintf("data:/rest/v1/threads/%s*", threadID),
		fmt.Sprintf("data:/rest/v1/threads?id=eq.%s*", threadID),
	}

	for _, pattern := range patterns {
		if err := InvalidateCache(redisClient, pattern); err != nil {
			log.Printf("[DataCache] Failed to invalidate cache for pattern %s: %v", pattern, err)
		}
	}
}

// InvalidateCacheForProfile invalidates all cache entries related to a profile
func InvalidateCacheForProfile(redisClient *redis.Client, userID string) {
	patterns := []string{
		fmt.Sprintf("data:/rest/v1/profiles/%s*", userID),
		fmt.Sprintf("data:/rest/v1/profiles?id=eq.%s*", userID),
		fmt.Sprintf("data:/rest/v1/profiles?id=in.*%s*", userID),
	}

	for _, pattern := range patterns {
		if err := InvalidateCache(redisClient, pattern); err != nil {
			log.Printf("[DataCache] Failed to invalidate cache for pattern %s: %v", pattern, err)
		}
	}
}

// InvalidateCacheForBoard invalidates all cache entries related to a board
func InvalidateCacheForBoard(redisClient *redis.Client, boardID string) {
	patterns := []string{
		fmt.Sprintf("data:/rest/v1/threads?board_id=eq.%s*", boardID),
		fmt.Sprintf("data:/rest/v1/boards/%s*", boardID),
	}

	for _, pattern := range patterns {
		if err := InvalidateCache(redisClient, pattern); err != nil {
			log.Printf("[DataCache] Failed to invalidate cache for pattern %s: %v", pattern, err)
		}
	}
}
